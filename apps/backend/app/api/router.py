from fastapi import APIRouter

from app.api.routes.auth import router as auth_router
from app.api.routes.files import router as files_router
from app.api.routes.quizzes import router as quizzes_router
from app.api.routes.summaries import router as summaries_router
from app.api.routes.flashcards import router as flashcards_router

api_router = APIRouter()
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(files_router, prefix="/files", tags=["files"])
api_router.include_router(quizzes_router, prefix="/quizzes", tags=["quizzes"])
api_router.include_router(summaries_router, prefix="/summaries", tags=["summaries"])
api_router.include_router(flashcards_router, prefix="/flashcards", tags=["flashcards"])
