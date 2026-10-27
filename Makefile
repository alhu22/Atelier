
.PHONY: cop rules start

cop:
	@set -a; \
	source .env; \
	set +a; \
	exec copilot "$$@"

rules:
	npx firebase-tools deploy --only firestore:rules --project atelier-6f995

start:
	npm start
