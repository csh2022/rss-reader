.PHONY: build-backend
build-backend:
	cd backend && go build -o output/rss-reader main.go

.PHONY: run-backend
run-backend:
	./backend/output/rss-reader > log 2>&1

.PHONY: install-frontend
install-frontend:
	cd frontend && npm install

.PHONY: start-frontend
start-frontend:
	cd frontend && npm start -- --host 0.0.0.0

.PHONY: build-dev-docker
build-dev-docker:
	docker build -t rss-reader-dev:latest -f hack/docker/dockerfile.dev .

.PHONY: build-runtime-docker
build-runtime-docker:
	docker build -t rss-reader-runtime:latest -f hack/docker/dockerfile.runtime .
