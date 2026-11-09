variable "REGISTRY_IMAGE" {
  default = "ghcr.io/thatintrovertdeveloper/stremio-file-server"
}

group "default" {
  targets = ["alpine", "ubuntu"]
}

# Note: neither target publishes :latest — that tag belongs to the split
# file-server image (docker-publish.yml matrix build). Overwriting it here
# would silently swap the two-container deployment for the all-in-one one.
target "alpine" {
  dockerfile = "Dockerfile.alpine"
  tags       = ["${REGISTRY_IMAGE}:alpine"]
  platforms  = ["linux/amd64", "linux/arm64"]
}

target "ubuntu" {
  dockerfile = "Dockerfile.ubuntu"
  tags       = ["${REGISTRY_IMAGE}:ubuntu"]
  platforms  = ["linux/amd64", "linux/arm64"]
}
