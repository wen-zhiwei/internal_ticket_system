from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    host: str = "127.0.0.1"
    port: int = 8090
    database_url: str = (
        "postgresql://internal_ticket_system:internal_ticket_system@localhost:5432/"
        "internal_ticket_system?sslmode=disable"
    )
    go_api_base_url: str = "http://127.0.0.1:8080/api"
    assistant_service_token: str = ""
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = ""
    assistant_request_timeout_seconds: float = 30.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
