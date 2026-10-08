.PHONY: dev api assistant frontend install assistant-install lint format format-check test build db-up db-down db-migrate

ASSISTANT_PYTHON ?= .venv-assistant/bin/python
ASSISTANT_RUFF ?= .venv-assistant/bin/ruff

install:
	cd frontend && npm install
	cd backend && go mod download
	$(MAKE) assistant-install

assistant-install:
	python3.12 -m venv .venv-assistant
	.venv-assistant/bin/pip install -r assistant-service/requirements-dev.txt

api:
	@set -a; if test -f .env; then . ./.env; fi; set +a; cd backend && GOCACHE=$${GOCACHE:-/tmp/internal_ticket_system-go-cache} go run ./cmd/server

assistant:
	@assistant_python="$(abspath $(ASSISTANT_PYTHON))"; \
	set -a; if test -f .env; then . ./.env; fi; set +a; \
	cd assistant-service && "$$assistant_python" -m uvicorn main:app --host $${HOST:-127.0.0.1} --port $${PORT:-8090}

frontend:
	@set -a; if test -f .env; then . ./.env; fi; set +a; cd frontend && npm run dev

dev:
	@echo "Run in three terminals: make api, make assistant and make frontend"

lint:
	cd frontend && npm run lint
	cd backend && GOCACHE=$${GOCACHE:-/tmp/internal_ticket_system-go-cache} go vet ./...
	cd assistant-service && $(abspath $(ASSISTANT_RUFF)) check .

format:
	find backend -name '*.go' -print0 | xargs -0 gofmt -w
	cd frontend && npm run format
	cd assistant-service && $(abspath $(ASSISTANT_RUFF)) format .

format-check:
	@test -z "$$(find backend -name '*.go' -print0 | xargs -0 gofmt -l)" || (echo "Go files need formatting"; exit 1)
	cd frontend && npm run format:check
	cd assistant-service && $(abspath $(ASSISTANT_RUFF)) format --check .

assistant-test:
	cd assistant-service && $(abspath $(ASSISTANT_PYTHON)) -m pytest -q

test:
	cd backend && GOCACHE=$${GOCACHE:-/tmp/internal_ticket_system-go-cache} go test ./...
	cd frontend && npm test
	$(MAKE) assistant-test

build:
	cd backend && GOCACHE=$${GOCACHE:-/tmp/internal_ticket_system-go-cache} go build ./...
	cd frontend && npm run build
	cd assistant-service && PYTHONDONTWRITEBYTECODE=1 $(abspath $(ASSISTANT_PYTHON)) -c "import api_client, config, graph, main, pending_actions, runtime, tools"

db-up:
	docker compose up -d postgres

db-down:
	docker compose down

db-migrate:
	@set -e; \
	for file in db/migrations/*.sql; do \
		echo "Applying $$file"; \
		if command -v psql >/dev/null 2>&1; then \
			psql "$${DATABASE_URL:-postgres://internal_ticket_system:internal_ticket_system@localhost:5432/internal_ticket_system?sslmode=disable}" -v ON_ERROR_STOP=1 -f "$$file"; \
		elif test -n "$$(docker compose ps -q postgres 2>/dev/null)"; then \
			docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U internal_ticket_system -d internal_ticket_system < "$$file"; \
		else \
			echo "psql is unavailable and the Docker PostgreSQL service is not running"; \
			exit 1; \
		fi; \
	done
