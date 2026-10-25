"""The avatar is a local animated SVG (documented fallback), so there is no
remote session to manage. Lip sync is driven in the browser from audio loudness."""
STATES = ["idle", "listening", "thinking", "speaking", "error"]

def status():
    return {"mode": "animated-svg-human", "states": STATES, "lip_sync": "audio-amplitude"}
