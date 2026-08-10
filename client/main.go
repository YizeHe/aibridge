// AI Bridge local agent
// Polls cloud for user messages, accepts agent replies, and can read the local workdir.
//
// Usage:
//
//	aibridge -key ak_xxx -project my-app
//	aibridge -key ak_xxx -project my-app -workdir .
//	aibridge -key ak_xxx -project my-app -reply "hello"
//	aibridge -key ak_xxx -project my-app -serve 127.0.0.1:5565
//	aibridge -key ak_xxx -project my-app -local-list
//	aibridge -key ak_xxx -project my-app -local-read README.md
//	aibridge -key ak_xxx -project my-app -put-file ./src/main.go src/main.go
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
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
	workdir := flag.String("workdir", envOr("AIBRIDGE_WORKDIR", "."), "local working directory (readable by agent)")
	interval := flag.Duration("interval", 3*time.Second, "poll interval")
	once := flag.Bool("once", false, "poll pending once and exit")
	reply := flag.String("reply", "", "send agent reply text and exit")
	replyFile := flag.String("reply-file", "", "send agent reply from file and exit")
	serve := flag.String("serve", "", "also serve local bridge HTTP (e.g. 127.0.0.1:5565)")
	ensure := flag.Bool("ensure", true, "auto-create project if missing")
	jsonOut := flag.Bool("json", false, "print pending as JSON")
	localList := flag.Bool("local-list", false, "list files under -workdir and exit")
	localRead := flag.String("local-read", "", "read a file relative to -workdir and print (exit)")
	putFile := flag.String("put-file", "", "upload local file to cloud project (path relative to workdir or absolute)")
	putAs := flag.String("as", "", "remote path for -put-file (default: same relative path)")
	getFile := flag.String("get-file", "", "download cloud project file path and print / write")
	getOut := flag.String("out", "", "write -get-file content to this local path")
	cloudList := flag.Bool("cloud-list", false, "list cloud project files and exit")
	flag.Parse()

	wd, err := filepath.Abs(*workdir)
	if err != nil {
		fmt.Fprintln(os.Stderr, "workdir:", err)
		os.Exit(2)
	}
	if st, err := os.Stat(wd); err != nil || !st.IsDir() {
		fmt.Fprintln(os.Stderr, "error: workdir must be an existing directory:", wd)
		os.Exit(2)
	}

	// Local-only commands: still allow without key for pure local read
	if *localList {
		entries, err := listWorkdir(wd, 400)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		if *jsonOut {
			_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"success": true, "workdir": wd, "files": entries})
		} else {
			fmt.Println("workdir:", wd)
			for _, e := range entries {
				fmt.Println(e)
			}
		}
		return
	}
	if *localRead != "" {
		b, rel, err := readWorkdirFile(wd, *localRead)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		if *jsonOut {
			_ = json.NewEncoder(os.Stdout).Encode(map[string]any{
				"success": true, "workdir": wd, "path": rel, "content": string(b),
			})
		} else {
			os.Stdout.Write(b)
		}
		return
	}

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
		}
	}

	if *cloudList {
		if err := listCloudFiles(client, baseURL, *key, *project, *jsonOut); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}

	if *getFile != "" {
		if err := getCloudFile(client, baseURL, *key, *project, *getFile, *getOut, *jsonOut); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}

	if *putFile != "" {
		remote := *putAs
		if remote == "" {
			// prefer path relative to workdir when under workdir
			abs, err := filepath.Abs(*putFile)
			if err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(1)
			}
			if rel, err := filepath.Rel(wd, abs); err == nil && !strings.HasPrefix(rel, "..") {
				remote = filepath.ToSlash(rel)
			} else {
				remote = filepath.ToSlash(filepath.Base(abs))
			}
		}
		if err := putLocalToCloud(client, baseURL, *key, *project, wd, *putFile, remote); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Printf("ok: uploaded %s -> %s\n", *putFile, remote)
		return
	}

	if *replyFile != "" {
		// allow reply-file relative to workdir
		path := *replyFile
		if !filepath.IsAbs(path) {
			cand := filepath.Join(wd, path)
			if _, err := os.Stat(cand); err == nil {
				path = cand
			}
		}
		b, err := os.ReadFile(path)
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
		go runLocalServer(*serve, client, baseURL, *key, *project, wd)
		fmt.Println("local bridge listening on http://" + *serve + "/")
		fmt.Println("  workdir:", wd)
		fmt.Println("  GET /api/workdir/list  GET /api/workdir/read?path=...")
	}

	if *once {
		if err := pollOnce(client, baseURL, *key, *project, *jsonOut); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}

	fmt.Printf("aibridge agent started\n  base=%s\n  project=%s\n  workdir=%s\n  interval=%s\n", baseURL, *project, wd, interval.String())
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

func listCloudFiles(client *http.Client, base, key, project string, asJSON bool) error {
	var out map[string]any
	url := fmt.Sprintf("%s/api/agent/files?project=%s", base, urlQuery(project))
	if err := doJSON(client, http.MethodGet, url, key, nil, &out); err != nil {
		return err
	}
	if asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(out)
	}
	files, _ := out["files"].([]any)
	for _, f := range files {
		m, _ := f.(map[string]any)
		fmt.Println(m["path"])
	}
	return nil
}

func getCloudFile(client *http.Client, base, key, project, path, outPath string, asJSON bool) error {
	var out map[string]any
	url := fmt.Sprintf("%s/api/agent/file?project=%s&path=%s", base, urlQuery(project), urlQuery(path))
	if err := doJSON(client, http.MethodGet, url, key, nil, &out); err != nil {
		return err
	}
	file, _ := out["file"].(map[string]any)
	content, _ := file["content"].(string)
	enc, _ := file["encoding"].(string)
	var raw []byte
	if enc == "base64" {
		b, err := base64.StdEncoding.DecodeString(content)
		if err != nil {
			return err
		}
		raw = b
	} else {
		raw = []byte(content)
	}
	if outPath != "" {
		if err := os.MkdirAll(filepath.Dir(outPath), 0o755); err != nil {
			return err
		}
		return os.WriteFile(outPath, raw, 0o644)
	}
	if asJSON {
		encw := json.NewEncoder(os.Stdout)
		encw.SetIndent("", "  ")
		return encw.Encode(out)
	}
	_, err := os.Stdout.Write(raw)
	return err
}

func putLocalToCloud(client *http.Client, base, key, project, workdir, localPath, remote string) error {
	abs := localPath
	if !filepath.IsAbs(abs) {
		abs = filepath.Join(workdir, localPath)
	}
	b, err := os.ReadFile(abs)
	if err != nil {
		return err
	}
	// text by default; binary as base64
	encoding := "utf8"
	content := string(b)
	if !isLikelyText(b) {
		encoding = "base64"
		content = base64.StdEncoding.EncodeToString(b)
	}
	var out map[string]any
	return doJSON(client, http.MethodPut, base+"/api/agent/file", key, map[string]any{
		"project":  project,
		"path":     remote,
		"content":  content,
		"encoding": encoding,
	}, &out)
}

func isLikelyText(b []byte) bool {
	if len(b) == 0 {
		return true
	}
	n := len(b)
	if n > 8000 {
		n = 8000
	}
	for i := 0; i < n; i++ {
		if b[i] == 0 {
			return false
		}
	}
	return true
}

// listWorkdir returns relative paths under root (skip heavy dirs).
func listWorkdir(root string, limit int) ([]string, error) {
	skipDir := map[string]bool{
		".git": true, "node_modules": true, ".wrangler": true, "dist": true,
		".venv": true, "venv": true, "__pycache__": true, ".idea": true,
	}
	var out []string
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		name := d.Name()
		if d.IsDir() {
			if skipDir[name] {
				return filepath.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return nil
		}
		out = append(out, filepath.ToSlash(rel))
		if limit > 0 && len(out) >= limit {
			return fs.SkipAll
		}
		return nil
	})
	return out, err
}

func readWorkdirFile(root, rel string) ([]byte, string, error) {
	rel = strings.TrimSpace(rel)
	rel = strings.TrimPrefix(rel, "/")
	rel = filepath.Clean(rel)
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return nil, "", fmt.Errorf("path escapes workdir")
	}
	abs := filepath.Join(root, rel)
	abs, err := filepath.Abs(abs)
	if err != nil {
		return nil, "", err
	}
	rootAbs, _ := filepath.Abs(root)
	if !strings.HasPrefix(abs, rootAbs+string(os.PathSeparator)) && abs != rootAbs {
		return nil, "", fmt.Errorf("path escapes workdir")
	}
	b, err := os.ReadFile(abs)
	if err != nil {
		return nil, "", err
	}
	return b, filepath.ToSlash(rel), nil
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

// Minimal local HTTP bridge compatible with legacy 5565 tools + workdir file APIs
func runLocalServer(addr string, client *http.Client, base, key, project, workdir string) {
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
		writeJSON(w, 200, map[string]any{"success": true, "project": project, "workdir": workdir})
	})
	mux.HandleFunc("/api/workdir/list", func(w http.ResponseWriter, r *http.Request) {
		entries, err := listWorkdir(workdir, 800)
		if err != nil {
			writeJSON(w, 500, map[string]any{"success": false, "message": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"success": true, "workdir": workdir, "files": entries})
	})
	mux.HandleFunc("/api/workdir/read", func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Query().Get("path")
		if p == "" {
			writeJSON(w, 400, map[string]any{"success": false, "message": "path required"})
			return
		}
		b, rel, err := readWorkdirFile(workdir, p)
		if err != nil {
			writeJSON(w, 404, map[string]any{"success": false, "message": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{
			"success": true,
			"workdir": workdir,
			"path":    rel,
			"size":    len(b),
			"content": string(b),
		})
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprintf(w, "AI Bridge local agent\nproject=%s\ncloud=%s\nworkdir=%s\n", project, base, workdir)
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
