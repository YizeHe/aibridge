// AI Bridge local agent
// Polls cloud for user messages and accepts agent replies (CLI + optional local HTTP).
//
// Usage:
//
//	aibridge -key ak_xxx -project my-app
//	aibridge -key ak_xxx -project my-app -reply "hello"
//	aibridge -key ak_xxx -project my-app -serve 127.0.0.1:5565
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const defaultBase = "https://aibridge.tanstudio.me"

type pendingResp struct {
	Success  bool `json:"success"`
	Messages []struct {
		ID   string `json:"id"`
		Role string `json:"role"`
		Text string `json:"text"`
		Ts   string `json:"ts"`
	} `json:"messages"`
	Project struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
		Slug string `json:"slug"`
	} `json:"project"`
	Message string `json:"message"`
}

type replyResp struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

type projectEnsureResp struct {
	Success bool `json:"success"`
	Project struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
		Slug string `json:"slug"`
	} `json:"project"`
	Message string `json:"message"`
	Created bool   `json:"created"`
}

func main() {
	base := flag.String("base", envOr("AIBRIDGE_BASE", defaultBase), "cloud base URL")
	key := flag.String("key", envOr("AIBRIDGE_KEY", ""), "API key (ak_...)")
	project := flag.String("project", envOr("AIBRIDGE_PROJECT", ""), "project name or slug")
	interval := flag.Duration("interval", 3*time.Second, "poll interval")
	once := flag.Bool("once", false, "poll pending once and exit")
	reply := flag.String("reply", "", "send agent reply text and exit")
	replyFile := flag.String("reply-file", "", "send agent reply from file and exit")
	serve := flag.String("serve", "", "also serve local bridge HTTP (e.g. 127.0.0.1:5565)")
	ensure := flag.Bool("ensure", true, "auto-create project if missing")
	jsonOut := flag.Bool("json", false, "print pending as JSON")
	flag.Parse()

	if *key == "" {
		fmt.Fprintln(os.Stderr, "error: API key required (-key or AIBRIDGE_KEY)")
		os.Exit(2)
	}
	if *project == "" {
		fmt.Fprintln(os.Stderr, "error: project required (-project or AIBRIDGE_PROJECT)")
		os.Exit(2)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	baseURL := strings.TrimRight(*base, "/")

	if *ensure {
		if err := ensureProject(client, baseURL, *key, *project); err != nil {
			fmt.Fprintln(os.Stderr, "ensure project:", err)
			// continue — project may already exist under different name resolution
		}
	}

	if *replyFile != "" {
		b, err := os.ReadFile(*replyFile)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		*reply = string(b)
	}
	if *reply != "" {
		if err := sendReply(client, baseURL, *key, *project, *reply); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println("ok: reply sent")
		return
	}

	if *serve != "" {
		go runLocalServer(*serve, client, baseURL, *key, *project)
		fmt.Println("local bridge listening on http://" + *serve + "/")
	}

	if *once {
		if err := pollOnce(client, baseURL, *key, *project, *jsonOut); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}

	fmt.Printf("aibridge agent started\n  base=%s\n  project=%s\n  interval=%s\n", baseURL, *project, interval.String())
	for {
		if err := pollOnce(client, baseURL, *key, *project, *jsonOut); err != nil {
			fmt.Fprintln(os.Stderr, "poll:", err)
		}
		time.Sleep(*interval)
	}
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func doJSON(client *http.Client, method, url, key string, body any, out any) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, url, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	if out != nil {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("decode %s: %w\nbody: %s", url, err, string(data))
		}
	}
	if res.StatusCode >= 400 {
		return fmt.Errorf("%s -> %s: %s", url, res.Status, string(data))
	}
	return nil
}

func ensureProject(client *http.Client, base, key, name string) error {
	var out projectEnsureResp
	err := doJSON(client, http.MethodPost, base+"/api/agent/projects", key, map[string]string{
		"name": name,
	}, &out)
	if err != nil {
		return err
	}
	if !out.Success {
		return fmt.Errorf("%s", out.Message)
	}
	if out.Created {
		fmt.Printf("created project: %s (%s)\n", out.Project.Name, out.Project.Slug)
	} else {
		fmt.Printf("using project: %s (%s)\n", out.Project.Name, out.Project.Slug)
	}
	return nil
}

func pollOnce(client *http.Client, base, key, project string, asJSON bool) error {
	var out pendingResp
	url := fmt.Sprintf("%s/api/agent/pending?project=%s", base, urlQuery(project))
	if err := doJSON(client, http.MethodGet, url, key, nil, &out); err != nil {
		return err
	}
	if !out.Success {
		return fmt.Errorf("%s", out.Message)
	}
	if asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(out)
	}
	if len(out.Messages) == 0 {
		return nil
	}
	for _, m := range out.Messages {
		fmt.Printf("\n----- pending user message [%s] %s -----\n%s\n", m.ID, m.Ts, m.Text)
	}
	// Write latest pending dump for AI tools
	_ = os.MkdirAll(configDir(), 0o755)
	path := filepath.Join(configDir(), "pending.json")
	b, _ := json.MarshalIndent(out, "", "  ")
	_ = os.WriteFile(path, b, 0o644)
	return nil
}

func sendReply(client *http.Client, base, key, project, text string) error {
	var out replyResp
	err := doJSON(client, http.MethodPost, base+"/api/agent/reply", key, map[string]string{
		"project": project,
		"text":    text,
	}, &out)
	if err != nil {
		return err
	}
	if !out.Success {
		return fmt.Errorf("%s", out.Message)
	}
	return nil
}

func urlQuery(s string) string {
	return strings.ReplaceAll(s, " ", "%20")
}

func configDir() string {
	if d, err := os.UserConfigDir(); err == nil {
		return filepath.Join(d, "aibridge")
	}
	return ".aibridge"
}

// Minimal local HTTP bridge compatible with legacy 5565 tools
func runLocalServer(addr string, client *http.Client, base, key, project string) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/pending", func(w http.ResponseWriter, r *http.Request) {
		var out pendingResp
		url := fmt.Sprintf("%s/api/agent/pending?project=%s", base, urlQuery(project))
		if err := doJSON(client, http.MethodGet, url, key, nil, &out); err != nil {
			writeJSON(w, 500, map[string]any{"success": false, "message": err.Error()})
			return
		}
		writeJSON(w, 200, out)
	})
	mux.HandleFunc("/api/agent/reply", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, 405, map[string]any{"success": false, "message": "POST only"})
			return
		}
		var body struct {
			Text string `json:"text"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if strings.TrimSpace(body.Text) == "" {
			writeJSON(w, 400, map[string]any{"success": false, "message": "empty"})
			return
		}
		if err := sendReply(client, base, key, project, body.Text); err != nil {
			writeJSON(w, 500, map[string]any{"success": false, "message": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"success": true})
	})
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"success": true, "project": project})
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprintf(w, "AI Bridge local agent\nproject=%s\ncloud=%s\n", project, base)
	})
	if err := http.ListenAndServe(addr, mux); err != nil {
		fmt.Fprintln(os.Stderr, "local server:", err)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
