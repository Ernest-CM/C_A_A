from fastapi import APIRouter

from app.api.routes.auth import router as auth_router
from app.api.routes.files import router as files_router
from app.api.routes.quizzes import router as quizzes_router
from app.api.routes.summaries import router as summaries_router
from app.api.routes.flashcards import router as flashcards_router
from app.api.routes.mindmaps import router as mindmaps_router
from app.api.routes.chat import router as chat_router

api_router = APIRouter()
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(files_router, prefix="/files", tags=["files"])
api_router.include_router(quizzes_router, prefix="/quizzes", tags=["quizzes"])
api_router.include_router(summaries_router, prefix="/summaries", tags=["summaries"])
api_router.include_router(flashcards_router, prefix="/flashcards", tags=["flashcards"])
api_router.include_router(mindmaps_router, prefix="/mindmaps", tags=["mindmaps"])
api_router.include_router(chat_router, prefix="/chat", tags=["chat"])
