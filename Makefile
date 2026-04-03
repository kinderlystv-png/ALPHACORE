.PHONY: help bootstrap check clean lint test run recommend-rank

help:
	@echo "Available targets:"
	@echo "  make bootstrap  - initialize project skeleton"
	@echo "  make check      - verify repository structure"
	@echo "  make lint       - run Ruff"
	@echo "  make test       - run tests"
	@echo "  make run        - run local API server"
	@echo "  make clean      - remove generated cache artifacts"
	@echo "  make recommend-rank - rank recommendation cards by feedback"

bootstrap:
	./scripts/bootstrap.sh

check:
	./scripts/check.sh

lint:
	@PYTHONPATH=src ruff check src tests

test:
	@PYTHONPATH=src pytest

run:
	@PYTHONPATH=src uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

clean:
	@find . -type d -name '__pycache__' -prune -exec rm -rf {} +
	@find . -type d -name '.pytest_cache' -prune -exec rm -rf {} +
	@find . -type d -name '.ruff_cache' -prune -exec rm -rf {} +
	@find . -type f -name '*.pyc' -delete
	@echo "Clean complete"


recommend-rank:
	@python scripts/recommendation_rank.py
