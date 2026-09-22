.PHONY: start stop logs scan reset install client server test

start:
	docker compose up -d

stop:
	docker compose down

logs:
	docker compose logs -f

scan:
	@echo "Triggering library scan..."
	curl -s -X POST http://localhost:3000/api/scan || echo "Scan endpoint not available (is the server running?)"

reset:
	docker compose down -v --remove-orphans
	docker compose up -d --build

install-server:
	cd server && npm install

install-client:
	cd client && npm install

client:
	cd client && npm run dev

server:
	cd server && npm run dev

test:
	cd server && npm test && cd ../client && npm test
