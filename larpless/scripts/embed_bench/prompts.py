"""SigLIP prompts shared by bench.py and export_prompts.py (which bakes them into the Windows app)."""

IMAGE_TEMPLATES = [
    "a screenshot of a computer screen showing {name} study material: {kws}",
    "a screenshot of {name} lecture notes, slides, homework or a textbook",
]
STUDY_PROMPTS = [
    "a screenshot of a computer screen showing study material, lecture notes, a textbook, slides or homework",
    "a screenshot of a student doing schoolwork, reading a paper or solving exercises",
    "a screenshot of a code editor with a programming assignment",
]
DISTRACTION_PROMPTS = [
    "a screenshot of a social media feed with photos, likes and comments",
    "a screenshot of a video game",
    "a screenshot of an online shopping website with products and prices",
    "a screenshot of a chat app with messages between friends",
    "a screenshot of a music video or entertainment video on YouTube",
    "a screenshot of a streaming service like Netflix",
    "a screenshot of a news website",
]
