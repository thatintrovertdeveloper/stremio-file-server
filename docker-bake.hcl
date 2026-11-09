variable "RELEASE" {
  default = "latest"
}

group "default" {
  targets = ["alpine", "ubuntu"]
}

target "alpine" {
  dockerfile = "Dockerfile.alpine"
  tags = [
    "ghcr.io/thatintrovertdeveloper/stremio-file-server:alpine",
    "ghcr.io/thatintrovertdeveloper/stremio-file-server:latest"
  ]
  platforms = ["linux/amd64", "linux/arm64"]
}

target "ubuntu" {
  dockerfile = "Dockerfile.ubuntu"
  tags = [
    "ghcr.io/thatintrovertdeveloper/stremio-file-server:ubuntu"
  ]
  platforms = ["linux/amd64", "linux/arm64"]
}
