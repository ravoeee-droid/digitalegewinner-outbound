"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import { track } from "./track";

type YTPlayer = { playVideo(): void; pauseVideo(): void; seekTo(seconds: number, allowSeekAhead: boolean): void; getCurrentTime(): number; getDuration(): number; destroy(): void };
type YTApi = { Player: new (el: HTMLElement, options: Record<string, unknown>) => YTPlayer };
declare global { interface Window { YT?: YTApi; onYouTubeIframeAPIReady?: () => void } }

function loadYouTube(): Promise<YTApi> {
  return new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT as YTApi); };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  });
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

// Sieht aus wie eine Loom-Aufnahme: Screenshot der Betriebs-Website als Bildschirm, Raphael als runte Kamera unten links.
export default function VideoPlayer({ youtubeId, screenshot, company }: { youtubeId: string; screenshot: string; company: string }) {
  const mount = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const watched = useRef(0);
  const sentPlay = useRef(false);
  const milestones = useRef(new Set<number>());

  useEffect(() => {
    let cancelled = false;
    loadYouTube().then((yt) => {
      if (cancelled || !mount.current) return;
      player.current = new yt.Player(mount.current, {
        videoId: youtubeId,
        host: "https://www.youtube-nocookie.com",
        playerVars: { controls: 0, rel: 0, modestbranding: 1, playsinline: 1, disablekb: 1, fs: 0, iv_load_policy: 3 },
        events: {
          onReady: () => { setReady(true); setDuration(player.current?.getDuration() || 0); },
          onStateChange: (event: { data: number }) => {
            setPlaying(event.data === 1);
            if (event.data === 1) {
              setStarted(true); setDuration(player.current?.getDuration() || 0);
              if (!sentPlay.current) { sentPlay.current = true; track("play"); }
            }
            if (event.data === 2 || event.data === 0) track("watch", Math.round(watched.current));
            if (event.data === 0) { setStarted(false); setTime(0); }
          },
        },
      });
    });
    return () => { cancelled = true; player.current?.destroy(); player.current = null; };
  }, [youtubeId]);

  useEffect(() => {
    const flush = () => { if (watched.current > 0) track("watch", Math.round(watched.current)); };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const now = player.current?.getCurrentTime() || 0;
      setTime(now);
      watched.current += 0.25;
      const total = player.current?.getDuration() || 0;
      if (total > 0) for (const step of [25, 50, 75, 100]) {
        if (now / total >= (step === 100 ? 0.97 : step / 100) && !milestones.current.has(step)) { milestones.current.add(step); track("progress", step); }
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [playing]);

  const toggle = useCallback(() => {
    if (!player.current) return;
    if (playing) player.current.pauseVideo(); else player.current.playVideo();
  }, [playing]);

  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!player.current || !duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const target = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * duration;
    player.current.seekTo(target, true);
    setTime(target);
  };

  return (
    <div className={styles.player} role="group" aria-label={`Video für ${company}`}>
      <div className={styles.screen} style={{ backgroundImage: `url(${screenshot})` }} />
      <div className={styles.cam}>
        <div className={styles.camInner} ref={mount} />
        {!started && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.poster} src={`https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`} alt="" />
        )}
      </div>
      {!playing && (
        <button type="button" className={styles.bigPlay} onClick={toggle} disabled={!ready} aria-label={started ? "Video fortsetzen" : "Video abspielen"}>
          <span className={styles.bigIcon} aria-hidden="true">▶</span>
          {!started && <span className={styles.bigLabel}>Video abspielen · ca. {duration ? clock(duration) : "1:30"} Min</span>}
        </button>
      )}
      {playing && <button type="button" className={styles.tapLayer} onClick={toggle} aria-label="Video pausieren" />}
      <div className={styles.bar}>
        <button type="button" className={styles.barButton} onClick={toggle} disabled={!ready} aria-label={playing ? "Pause" : "Wiedergabe"}>{playing ? "❚❚" : "▶"}</button>
        <span className={styles.time}>{clock(time)} / {duration ? clock(duration) : "–:––"}</span>
        <div className={styles.track} onClick={seek} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={duration ? Math.round((time / duration) * 100) : 0} aria-label="Fortschritt">
          <div className={styles.fill} style={{ width: duration ? `${(time / duration) * 100}%` : "0%" }} />
        </div>
      </div>
    </div>
  );
}
