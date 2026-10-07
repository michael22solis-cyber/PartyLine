"""Render intro/scene.html into public/intro.mp4 (720x1280, 24 fps, 30 s).

Needs: python3 with playwright + numpy, and ffmpeg.
    python3 intro/render.py
If intro/assets/voice.mp3 (or .wav) exists, it's mixed over the music as the Caretaker's narration.
If intro/assets/ruth.mp4 (marcus, lily, teddy) exists, that suspect moves instead of being a still.
"""
import os, sys, json, shutil, subprocess, tempfile, wave
import numpy as np
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, '..', 'public', 'intro.mp4')
FPS, DUR, SR = 24, 30.0, 44100
WARP_FWD = lambda x: x   # original scene time -> final video time
WARP_BACK = lambda x: x  # final video time -> original scene time


def soundtrack(path):
    t = np.arange(int(DUR * SR)) / SR
    out = np.zeros_like(t)

    def env(start, length, attack=0.005, decay=None):
        start = WARP_FWD(start)
        e = np.zeros_like(t)
        m = (t >= start) & (t < start + length)
        local = t[m] - start
        a = np.clip(local / attack, 0, 1)
        d = np.exp(-local / decay) if decay else np.clip((length - local) / 0.05, 0, 1)
        e[m] = a * d
        return e

    rng = np.random.default_rng(7)
    noise = rng.uniform(-1, 1, t.size)

    # low drone, breathing slowly
    drone = (np.sin(2 * np.pi * 55 * t) + 0.6 * np.sin(2 * np.pi * 82.4 * t) + 0.3 * np.sin(2 * np.pi * 110.7 * t))
    out += 0.07 * drone * (0.7 + 0.3 * np.sin(2 * np.pi * 0.18 * t)) * np.clip(t / 1.5, 0, 1)

    # cold-open static and a crackle at every cut
    out += 0.22 * noise * env(0, 0.7)
    for c in (3.0, 8.0, 13.0, 21.0, 26.0):
        out += 0.12 * noise * env(c - 0.06, 0.14)

    # old rotary bell: two bursts
    bell = (np.sin(2 * np.pi * 950 * t) + 0.5 * np.sin(2 * np.pi * 1420 * t)) * (np.sin(2 * np.pi * 20 * t) > 0)
    out += 0.09 * bell * (env(0.9, 1.0) + env(2.2, 0.75))

    # footsteps on the stairs
    for s in (10.3, 10.95, 11.6, 12.25):
        out += 0.35 * np.sin(2 * np.pi * 70 * t) * env(s, 0.25, decay=0.06)
        out += 0.05 * noise * env(s, 0.08, decay=0.02)

    # a hit on each suspect, heartbeat underneath
    for s in (13.0, 15.0, 17.0, 19.0):
        sweep = np.sin(2 * np.pi * (60 - 25 * np.clip(t - s, 0, 1)) * t)
        out += 0.4 * sweep * env(s, 1.2, decay=0.35)
    hb = 13.0
    while hb < 21:
        out += 0.3 * np.sin(2 * np.pi * 48 * t) * (env(hb, 0.2, decay=0.05) + 0.7 * env(hb + 0.2, 0.2, decay=0.05))
        hb += 0.86

    # modern phone ringing + buzzing on the nightstand
    ring = np.sin(2 * np.pi * 440 * t) + np.sin(2 * np.pi * 480 * t)
    buzz = np.sign(np.sin(2 * np.pi * 150 * t))
    r = 21.4
    while r < 25.8:
        out += 0.05 * ring * env(r, 0.4)
        out += 0.025 * buzz * env(r, 0.8)
        r += 1.6

    # title boom, then the window's click
    out += 0.55 * np.sin(2 * np.pi * (90 - 60 * np.clip((t - 26) / 2, 0, 1)) * t) * env(26.0, 3.0, decay=0.9)
    out += 0.08 * noise * env(26.0, 0.6, decay=0.15)
    out += 0.15 * noise * env(28.6, 0.03)

    out *= np.clip((DUR - t) / 0.6, 0, 1)
    out = out / max(1e-6, np.abs(out).max()) * 0.85
    pcm = (out * 32767).astype(np.int16)
    stereo = np.repeat(pcm[:, None], 2, axis=1)
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(stereo.tobytes())


CAPTION_STARTS = [0.9, 3.3, 8.3, 13.3, 17.1, 21.3, 23.5, 26.7]  # must match CAPTIONS in scene.html
CAPTION_ENDS = [2.9, 7.8, 12.9, 16.9, 20.9, 23.4, 25.9, 29.7]


def voice_track(tmp):
    """Trim each narration line, then stretch the scene timeline so every line fits its caption."""
    global DUR, WARP_FWD, WARP_BACK
    vdir = os.path.join(ROOT, 'assets', 'voice')
    files = [os.path.join(vdir, f'{i:02d}.mp3') for i in range(1, 9)]
    if not all(os.path.exists(f) for f in files):
        return None
    trimmed, lens = [], []
    for i, f in enumerate(files):
        out = os.path.join(tmp, f'line{i}.wav')
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', f, '-af',
                        'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,'
                        'silenceremove=stop_periods=-1:stop_duration=0.35:stop_threshold=-45dB', '-ar', str(SR), '-ac', '2', out], check=True)
        lens.append(float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out],
                                         capture_output=True, text=True).stdout.strip()))
        trimmed.append(out)
    O = [0.0] + CAPTION_STARTS + [30.0]
    N = [0.0, O[1]]
    for i in range(8):
        need = lens[i] + (0.9 if i == 7 else 0.45)
        N.append(N[-1] + max(O[i + 2] - O[i + 1], need))
    DUR = round(N[-1], 2)
    WARP_FWD = lambda x: float(np.interp(x, O, N))
    WARP_BACK = lambda x: float(np.interp(x, N, O))
    print(f'narration fits in {DUR:.1f}s (scenes stretched where a line runs long)')
    inputs, filters = [], []
    for i, f in enumerate(trimmed):
        ms = int(N[i + 1] * 1000)
        inputs += ['-i', f]
        filters.append(f'[{i}:a]adelay={ms}|{ms}[v{i}]')
    out = os.path.join(tmp, 'voice.wav')
    mix = ''.join(f'[v{i}]' for i in range(8)) + f'amix=inputs=8:normalize=0,apad=whole_dur={DUR}[out]'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *inputs, '-filter_complex', ';'.join(filters) + ';' + mix,
                    '-map', '[out]', '-ar', str(SR), '-ac', '2', out], check=True)
    return out


CLIP_OFFSET = 22  # start each 2-second suspect shot ~0.9 s into its 3-second clip, where the best moment is


def extract_clips():
    clips = {}
    cache = os.path.join(ROOT, '.cache')
    shutil.rmtree(cache, ignore_errors=True)
    for name in ('ruth', 'marcus', 'lily', 'teddy'):
        src = next((os.path.join(ROOT, 'assets', f'{name}.{e}') for e in ('mp4', 'mov', 'webm')
                    if os.path.exists(os.path.join(ROOT, 'assets', f'{name}.{e}'))), None)
        if not src:
            continue
        out = os.path.join(cache, name)
        os.makedirs(out, exist_ok=True)
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-vf', f'fps={FPS},scale=720:-2', '-q:v', '3',
                        os.path.join(out, 'f%04d.jpg')], check=True)
        frames = len([f for f in os.listdir(out) if f.endswith('.jpg')])
        clips[name] = {'frames': frames, 'dir': f'.cache/{name}', 'offset': min(CLIP_OFFSET, max(0, frames - 49))}
    return clips


def main():
    tmp = tempfile.mkdtemp(prefix='intro-')
    voice = voice_track(tmp)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=['--allow-file-access-from-files'])
            page = browser.new_page(viewport={'width': 720, 'height': 1280})
            page.goto('file://' + os.path.join(ROOT, 'scene.html'))
            page.evaluate('window.ready')
            clips = extract_clips()
            if clips:
                page.evaluate(f'window.CLIPS = {json.dumps(clips)}')
                print('moving suspects:', ', '.join(clips), flush=True)
            page.wait_for_timeout(300)
            frames = int(DUR * FPS)
            for i in range(frames):
                page.evaluate(f'setTimeAsync({WARP_BACK(i / FPS):.4f})')
                page.locator('#stage').screenshot(path=os.path.join(tmp, f'f{i:04d}.jpg'), type='jpeg', quality=88)
                if i % 120 == 0:
                    print(f'frame {i}/{frames}', flush=True)
            browser.close()

        music = os.path.join(tmp, 'music.wav')
        soundtrack(music)
        voice = voice or next((os.path.join(ROOT, 'assets', f'voice.{e}') for e in ('mp3', 'wav', 'm4a') if os.path.exists(os.path.join(ROOT, 'assets', f'voice.{e}'))), None)
        cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', os.path.join(tmp, 'f%04d.jpg'), '-i', music]
        if voice:
            cmd += ['-i', voice, '-filter_complex', '[1:a]volume=0.55[m];[2:a]volume=1.4[v];[m][v]amix=inputs=2:duration=first:normalize=0[a]', '-map', '0:v', '-map', '[a]']
        cmd += ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '27', '-preset', 'medium', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-shortest', OUT]
        subprocess.run(cmd, check=True)
        print('wrote', os.path.abspath(OUT), 'with narration' if voice else '(no narration yet)')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        shutil.rmtree(os.path.join(ROOT, '.cache'), ignore_errors=True)


if __name__ == '__main__':
    main()
