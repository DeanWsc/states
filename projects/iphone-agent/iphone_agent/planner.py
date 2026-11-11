"""Ask Claude what to do next, from a screenshot and the task."""
import base64
import io
from typing import Literal, Optional

from pydantic import BaseModel, Field

MODEL = "claude-opus-5-5"
MAX_SIDE = 1568  # longer images are downscaled by the API anyway; do it here so coordinates stay exact

SYSTEM = """You operate an iPhone for the user by looking at screenshots of its screen.
Each turn you get the task, what you have done so far, and the current screenshot.
Reply with exactly one next action. Coordinates are pixels in the screenshot you were given,
origin top-left. Tap the centre of the control you mean.

Actions:
- tap: tap at (x, y).
- swipe: drag from (x, y) to (x2, y2), for scrolling or swiping between pages.
- type: enter text into the focused field. Tap the field first.
- key: press one key: "enter", "backspace", "escape", "tab", or a letter with mods such as ["cmd"].
- home: go to the home screen.
- wait: the screen is still changing; look again.
- done: the task is complete. Say what you did in reason.
- fail: the task cannot be done from here. Say why in reason.

Stop and use fail rather than: paying, buying, sending money, deleting accounts or data, changing
passwords or security settings, or sending a message the task did not spell out. Do not enter
passwords or one-time codes."""


class Action(BaseModel):
    action: Literal["tap", "swipe", "type", "key", "home", "wait", "done", "fail"]
    x: Optional[int] = Field(default=None, description="pixels from the left of the screenshot")
    y: Optional[int] = Field(default=None, description="pixels from the top of the screenshot")
    x2: Optional[int] = None
    y2: Optional[int] = None
    text: Optional[str] = None
    key: Optional[str] = None
    mods: Optional[list[str]] = None
    reason: str = Field(description="one short sentence: what this does and why")


class Refused(RuntimeError):
    pass


def _encode(img):
    scale = min(1.0, MAX_SIDE / max(img.size))
    if scale < 1:
        img = img.resize((round(img.width * scale), round(img.height * scale)))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.standard_b64encode(buf.getvalue()).decode(), scale, img.size


class Planner:
    def __init__(self, client=None, model=MODEL, effort="medium"):
        if client is None:
            import anthropic

            client = anthropic.Anthropic()
        self.client = client
        self.model = model
        self.effort = effort

    def next_action(self, task, screenshot, history):
        data, scale, (w, h) = _encode(screenshot)
        done = "\n".join(f"{i + 1}. {a}" for i, a in enumerate(history[-12:])) or "(nothing yet)"
        response = self.client.beta.messages.parse(
            model=self.model,
            max_tokens=16000,
            system=SYSTEM,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": self.effort},
            output_format=Action,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": data}},
                    {"type": "text", "text": f"Task: {task}\nScreenshot size: {w}x{h} pixels.\nDone so far:\n{done}\nWhat is the next action?"},
                ],
            }],
        )
        if response.stop_reason == "refusal":
            raise Refused("the model declined this step")
        action = response.parsed_output
        if action is None:
            raise RuntimeError(f"no action in the reply (stop_reason={response.stop_reason})")
        # Back to full-resolution screenshot pixels.
        for f in ("x", "y", "x2", "y2"):
            v = getattr(action, f)
            if v is not None:
                setattr(action, f, round(v / scale))
        return action
