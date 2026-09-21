.PHONY: dev api frontend install lint format format-check test build db-up db-down db-migrate

install:
	cd frontend && npm install
	cd backend && go mod download

api:
	@set -a; if test -f .env; then . ./.env; fi; set +a; cd backend && GOCACHE=$${GOCACHE:-/tmp/internal_ticket_system-go-cache} go run ./cmd/server

frontend:
	@set -a; if test -f .env; then . ./.env; fi; set +a; cd frontend && npm run dev

dev:
	@echo "Run in two terminals: make api and make frontend"

lint:
	cd frontend && npm run lint
	cd backend && GOCACHE=$${GOCACHE:-/tmp/internal_ticket_system-go-cache} go vet ./...

format:
	find backend -name '*.go' -print0 | xargs -0 gofmt -w
	cd frontend && npm run format

format-check:
	@test -z "$$(find backend -name '*.go' -print0 | xargs -0 gofmt -l)" || (echo "Go files need formatting"; exit 1)
	cd frontend && npm run format:check

test:
	cd backend && GOCACHE=$${GOCACHE:-/tmp/internal_ticket_system-go-cache} go test ./...
	cd frontend && npm test

build:
	cd backend && GOCACHE=$${GOCACHE:-/tmp/internal_ticket_system-go-cache} go build ./...
	cd frontend && npm run build

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
