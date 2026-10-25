package podman

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"runtime"
	"strings"
	"time"
)

// RemoteSize returns the compressed size of a Docker Hub image. Images from
// other registries or local builds return ErrUnknownSize; callers must then
// ask for confirmation with an explicit "unknown size" label.
func RemoteSize(ctx context.Context, image string) (int64, error) {
	registry, repo, tag, err := splitImage(image)
	if err != nil {
		return 0, err
	}
	if registry != "docker.io" {
		return 0, ErrUnknownSize
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	token, err := dockerHubToken(ctx, repo)
	if err != nil {
		return 0, err
	}
	return manifestSize(ctx, repo, tag, token)
}

func splitImage(image string) (registry, repo, tag string, err error) {
	image = strings.TrimSpace(image)
	if image == "" {
		return "", "", "", fmt.Errorf("imagen vacía")
	}
	registry = "docker.io"
	rest := image
	if i := strings.IndexByte(rest, '/'); i > 0 && (strings.Contains(rest[:i], ".") || strings.Contains(rest[:i], ":")) {
		registry = rest[:i]
		rest = rest[i+1:]
	}
	if i := strings.LastIndexByte(rest, ':'); i > 0 && !strings.Contains(rest[i+1:], "/") {
		tag = rest[i+1:]
		rest = rest[:i]
	}
	if tag == "" {
		tag = "latest"
	}
	if registry == "docker.io" && !strings.Contains(rest, "/") {
		rest = "library/" + rest
	}
	if registry != "docker.io" {
		return registry, rest, tag, nil
	}
	return registry, rest, tag, nil
}

func dockerHubToken(ctx context.Context, repo string) (string, error) {
	url := "https://auth.docker.io/token?service=registry.docker.io&scope=repository:" + repo + ":pull"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("token de Docker Hub: HTTP %s", resp.Status)
	}
	var doc struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return "", err
	}
	if doc.Token == "" {
		return "", fmt.Errorf("token de Docker Hub vacío")
	}
	return doc.Token, nil
}

func manifestSize(ctx context.Context, repo, reference, token string) (int64, error) {
	body, contentType, err := fetchManifest(ctx, repo, reference, token)
	if err != nil {
		return 0, err
	}
	var doc struct {
		Layers []struct {
			Size int64 `json:"size"`
		} `json:"layers"`
		Manifests []struct {
			Digest   string `json:"digest"`
			Platform struct {
				OS           string `json:"os"`
				Architecture string `json:"architecture"`
			} `json:"platform"`
		} `json:"manifests"`
	}
	if err := json.Unmarshal(body, &doc); err != nil {
		return 0, err
	}
	if len(doc.Manifests) > 0 {
		for _, m := range doc.Manifests {
			if m.Platform.OS == "linux" && m.Platform.Architecture == runtime.GOARCH && m.Digest != "" {
				return manifestSize(ctx, repo, m.Digest, token)
			}
		}
		return 0, fmt.Errorf("la imagen %s no tiene variante linux/%s", repo, runtime.GOARCH)
	}
	if len(doc.Layers) == 0 {
		_ = contentType
		return 0, ErrUnknownSize
	}
	var total int64
	for _, l := range doc.Layers {
		total += l.Size
	}
	return total, nil
}

func fetchManifest(ctx context.Context, repo, reference, token string) ([]byte, string, error) {
	url := "https://registry-1.docker.io/v2/" + repo + "/manifests/" + reference
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", strings.Join([]string{
		"application/vnd.docker.distribution.manifest.v2+json",
		"application/vnd.oci.image.manifest.v1+json",
		"application/vnd.docker.distribution.manifest.list.v2+json",
		"application/vnd.oci.image.index.v1+json",
	}, ", "))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("manifiesto %s:%s: HTTP %s", repo, reference, resp.Status)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", err
	}
	return body, resp.Header.Get("Content-Type"), nil
}
