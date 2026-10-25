"""One place that turns OpenAI/network failures into short, friendly messages."""
import openai

class ServiceError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status

def friendly(e: Exception) -> tuple[int, str]:
    if isinstance(e, openai.AuthenticationError):
        return 401, "OpenAI rejected the API key. Check OPENAI_API_KEY in your .env file and restart the server."
    if isinstance(e, openai.RateLimitError):
        return 429, "OpenAI's rate limit or quota was reached. Wait a moment, or check your usage and billing."
    if isinstance(e, openai.APITimeoutError):
        return 504, "OpenAI took too long to answer. Please try again."
    if isinstance(e, openai.APIConnectionError):
        return 503, "Can't reach OpenAI. Check the internet connection."
    if isinstance(e, openai.OpenAIError):
        if "api_key" in str(e).lower():
            return 401, "No OpenAI API key found. Add OPENAI_API_KEY to your .env file and restart."
        return 502, "OpenAI returned an error. Please try again."
    return 502, "Unexpected error. Please try again."
