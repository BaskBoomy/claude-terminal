package main

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

var knownCategories = []string{"memory", "skills", "agents", "rules", "hooks"}
var allowedExtensions = map[string]bool{".md": true, ".sh": true}

type BrainFile struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
}

type BrainCategory struct {
	Name  string      `json:"name"`
	Dir   string      `json:"dir"`
	Files []BrainFile `json:"files"`
}

type BrainScope struct {
	ID         string          `json:"id"`
	Label      string          `json:"label"`
	Categories []BrainCategory `json:"categories"`
}

type Brain struct {
	cfg *Config
}

func NewBrain(cfg *Config) *Brain {
	return &Brain{cfg: cfg}
}

func (b *Brain) Scan() []BrainScope {
	claudeDir := filepath.Join(b.cfg.HomeDir, ".claude")
	projectsDir := filepath.Join(claudeDir, "projects")

	// 1. Global scope
	globalCats := make(map[string]string) // label → path
	for _, cat := range knownCategories {
		if cat == "memory" {
			continue
		}
		p := filepath.Join(claudeDir, cat)
		if isDir(p) {
			globalCats[cat] = p
		}
	}

	// 2. Discover projects
	seenProjects := make(map[string]string) // realPath → dirName
	if isDir(projectsDir) {
		entries, _ := os.ReadDir(projectsDir)
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			dpath := filepath.Join(projectsDir, e.Name())

			// Memory dirs
			mem := filepath.Join(dpath, "memory")
			if isDir(mem) && !isDirEmpty(mem) {
				label := "memory"
				if e.Name() != "-" {
					label = "memory (" + e.Name() + ")"
				}
				globalCats[label] = mem
			}

			// Reverse-map to real path
			realPath := dirNameToPath(e.Name())
			if realPath != "" && realPath != b.cfg.HomeDir && isDir(realPath) {
				seenProjects[realPath] = e.Name()
			}
		}
	}

	var scopes []BrainScope

	// Build global scope
	globalScope := b.buildScope("global", "Global", globalCats)
	if len(globalScope.Categories) > 0 {
		scopes = append(scopes, globalScope)
	}

	// 3. Project scopes
	var projectPaths []string
	for p := range seenProjects {
		projectPaths = append(projectPaths, p)
	}
	sort.Strings(projectPaths)

	for _, realPath := range projectPaths {
		claudePath := filepath.Join(realPath, ".claude")
		if !isDir(claudePath) {
			continue
		}
		cats := make(map[string]string)
		for _, cat := range knownCategories {
			if cat == "memory" {
				continue
			}
			p := filepath.Join(claudePath, cat)
			if isDir(p) {
				cats[cat] = p
			}
		}
		if len(cats) > 0 {
			name := filepath.Base(realPath)
			scope := b.buildScope(name, name, cats)
			if len(scope.Categories) > 0 {
				scopes = append(scopes, scope)
			}
		}
	}

	return scopes
}

func (b *Brain) buildScope(id, label string, cats map[string]string) BrainScope {
	var categories []BrainCategory
	// Sort category names for consistent output
	var catNames []string
	for name := range cats {
		catNames = append(catNames, name)
	}
	sort.Strings(catNames)

	for _, catName := range catNames {
		catPath := cats[catName]
		files := scanBrainDir(catPath)
		if len(files) > 0 {
			categories = append(categories, BrainCategory{
				Name:  catName,
				Dir:   catPath,
				Files: files,
			})
		}
	}
	return BrainScope{ID: id, Label: label, Categories: categories}
}

func scanBrainDir(dir string) []BrainFile {
	var files []BrainFile
	entries, err := os.ReadDir(dir)
	if err != nil {
		return files
	}

	for _, e := range entries {
		entryPath := filepath.Join(dir, e.Name())
		if e.Type().IsRegular() {
			ext := filepath.Ext(e.Name())
			if allowedExtensions[ext] {
				info, _ := e.Info()
				files = append(files, BrainFile{Name: e.Name(), Size: info.Size()})
			}
		} else if e.IsDir() {
			// Subdirectory: agents/billing-dev/billing-dev.md
			subEntries, _ := os.ReadDir(entryPath)
			for _, se := range subEntries {
				ext := filepath.Ext(se.Name())
				if !se.Type().IsRegular() || !allowedExtensions[ext] {
					continue
				}
				info, _ := se.Info()
				files = append(files, BrainFile{
					Name: filepath.Join(e.Name(), se.Name()),
					Size: info.Size(),
				})
			}
		}
	}
	return files
}

// ValidDir checks if dirpath is one of the known brain directories.
func (b *Brain) ValidDir(dirpath string) bool {
	abs, err := filepath.Abs(dirpath)
	if err != nil {
		return false
	}
	for _, scope := range b.Scan() {
		for _, cat := range scope.Categories {
			catAbs, err := filepath.Abs(cat.Dir)
			if err != nil {
				continue
			}
			if abs == catAbs {
				return true
			}
		}
	}
	return false
}

func (b *Brain) ResolvePath(dirpath, filename string) (string, bool) {
	if dirpath == "" || filename == "" {
		return "", false
	}
	if !b.ValidDir(dirpath) {
		return "", false
	}
	if strings.Contains(filename, "..") || strings.Contains(filename, "\\") {
		return "", false
	}

	parts := strings.Split(strings.ReplaceAll(filename, "\\", "/"), "/")
	if len(parts) > 2 {
		return "", false
	}

	ext := filepath.Ext(filename)
	if !allowedExtensions[ext] {
		return "", false
	}

	fullPath, err := filepath.Abs(filepath.Join(dirpath, filename))
	if err != nil {
		return "", false
	}

	base, err := filepath.Abs(dirpath)
	if err != nil {
		return "", false
	}

	if !strings.HasPrefix(fullPath, base+string(os.PathSeparator)) {
		return "", false
	}

	info, err := os.Stat(fullPath)
	if err != nil || info.IsDir() {
		return "", false
	}

	// Check writable
	f, err := os.OpenFile(fullPath, os.O_WRONLY, 0)
	writable := err == nil
	if f != nil {
		f.Close()
	}

	return fullPath, writable
}

// --- Git repos auto-discovery ---

type GitRepo struct {
	ID   string `json:"id"`
	Path string `json:"path"`
}

func DiscoverGitRepos(cfg *Config) []GitRepo {
	var repos []GitRepo
	seen := make(map[string]bool)
	projectsDir := filepath.Join(cfg.HomeDir, ".claude", "projects")

	if isDir(projectsDir) {
		entries, _ := os.ReadDir(projectsDir)
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			realPath := dirNameToPath(e.Name())
			if realPath == "" || realPath == cfg.HomeDir || seen[realPath] {
				continue
			}
			if isDir(filepath.Join(realPath, ".git")) {
				seen[realPath] = true
				repos = append(repos, GitRepo{
					ID:   filepath.Base(realPath),
					Path: realPath,
				})
			}
		}
	}

	// Also check claude-terminal itself
	if isDir(filepath.Join(cfg.RootDir, ".git")) && !seen[cfg.RootDir] {
		repos = append(repos, GitRepo{
			ID:   filepath.Base(cfg.RootDir),
			Path: cfg.RootDir,
		})
	}

	sort.Slice(repos, func(i, j int) bool { return repos[i].ID < repos[j].ID })
	return repos
}

// --- Helpers ---

func dirNameToPath(name string) string {
	name = strings.Trim(name, "-")
	segments := strings.Split(name, "-")
	if len(segments) == 0 {
		return ""
	}

	resolved := ""
	i := 0
	for i < len(segments) {
		matched := false
		for end := i + 1; end <= len(segments); end++ {
			candidate := resolved + "/" + strings.Join(segments[i:end], "-")
			if isDir(candidate) {
				resolved = candidate
				i = end
				matched = true
				break
			}
		}
		if !matched {
			resolved = resolved + "/" + strings.Join(segments[i:], "-")
			break
		}
	}

	if isDir(resolved) {
		return resolved
	}
	return ""
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func isDirEmpty(path string) bool {
	entries, err := os.ReadDir(path)
	return err != nil || len(entries) == 0
}
