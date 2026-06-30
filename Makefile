# proxsyno — convenience targets for the custom full-stack app.
#
# These build/run the app locally (app/server + app/web). For a full host
# deploy (Node + systemd service), use ./install-app.sh instead.

SERVER := app/server
WEB    := app/web

.DEFAULT_GOAL := help

.PHONY: help install build dev clean

help: ## Show this help
	@echo "proxsyno make targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN{FS=":.*?## "}{printf "  %-10s %s\n", $$1, $$2}'

install: ## Install npm deps for both server and web
	cd $(SERVER) && (npm ci || npm install)
	cd $(WEB)    && (npm ci || npm install)

build: ## Build both server (-> dist) and web (-> dist)
	cd $(SERVER) && npm run build
	cd $(WEB)    && npm run build

dev: ## Print how to run the two dev servers
	@echo "Run these in two terminals:"
	@echo ""
	@echo "  Terminal 1 (backend, :8800 with tsx watch):"
	@echo "      cd $(SERVER) && npm run dev"
	@echo ""
	@echo "  Terminal 2 (frontend, Vite :5173, proxies /api + /ws to :8800):"
	@echo "      cd $(WEB) && npm run dev"
	@echo ""
	@echo "Then open http://localhost:5173"
	@echo "(needs an env: copy deploy/proxsyno.env.example or export PROXSYNO_JWT_SECRET etc.)"

clean: ## Remove build artifacts and node_modules from both halves
	rm -rf $(SERVER)/dist $(SERVER)/node_modules
	rm -rf $(WEB)/dist    $(WEB)/node_modules
