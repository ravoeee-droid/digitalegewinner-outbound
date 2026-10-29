"use client";

import { useEffect, useRef } from "react";
import { markExplainerPlayed, track } from "./track";

type Player = { getCurrentTime(): number; getDuration(): number; getPlayerState(): number; getPlaybackRate(): number; pauseVideo(): void; destroy(): void };
type YouTube = { Player: new (element: HTMLElement, options: { events: { onReady(): void; onStateChange(event: { data: number }): void } }) => Player };
type ApiWindow = Window & { YT?: YouTube; onYouTubeIframeAPIReady?: () => void };

export default function ExplainerVideo({ src, title }: { src: string; title: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = host.current;
    const disclosure = container?.closest("details");
    if (!container || !disclosure) return;
    let player: Player | undefined;
    let cancelled = false, opened = false, confirmed = false, calendarSent = false;
    let previous = 0, previousWall = 0;
    let ranges: Array<[number, number]> = [];
    const milestones = new Set<number>();
    let sampleTimer: ReturnType<typeof setInterval> | undefined;
    let apiTimer: ReturnType<typeof setInterval> | undefined;
    const emit = (name: string, value = 0) => track("explainer_" + name, value);
    const sample = () => {
      if (!player) return;
      const position = player.getCurrentTime(), wall = performance.now();
      const elapsed = (wall - previousWall) / 1000;
      const delta = position - previous;
      if (player.getPlayerState() === 1 && document.visibilityState === "visible" && previousWall && delta > 0 && elapsed < 2 && delta <= elapsed * Math.max(1, player.getPlaybackRate()) + 0.3) {
        ranges.push([previous, position]);
        ranges.sort((a, b) => a[0] - b[0]);
        const merged: Array<[number, number]> = [];
        for (const range of ranges) {
          const last = merged[merged.length - 1];
          if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
          else merged.push([...range]);
        }
        ranges = merged;
        const watched = ranges.reduce((sum, [a, b]) => sum + b - a, 0);
        if (!confirmed && watched >= 3) { confirmed = true; markExplainerPlayed(); emit("play_confirmed"); }
        const duration = player.getDuration();
        const percent = duration > 0 ? watched / duration * 100 : 0;
        for (const step of [25, 50, 75]) {
          if (confirmed && percent >= step && !milestones.has(step)) {
            milestones.add(step); emit("progress", step);
          }
        }
      }
      previous = position; previousWall = wall;
    };
    const start = () => {
      if (!disclosure.open || opened) return;
      opened = true; emit("open");
      const frame = document.createElement("iframe");
      const url = new URL(src);
      url.searchParams.set("enablejsapi", "1"); url.searchParams.set("origin", window.location.origin);
      frame.src = url.toString(); frame.title = title;
      frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      frame.allowFullscreen = true; frame.referrerPolicy = "strict-origin-when-cross-origin";
      container.append(frame);
      const apiWindow = window as ApiWindow;
      if (!apiWindow.onYouTubeIframeAPIReady) apiWindow.onYouTubeIframeAPIReady = () => {};
      if (!apiWindow.YT?.Player && !document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const script = document.createElement("script"); script.src = "https://www.youtube.com/iframe_api"; script.async = true; document.head.append(script);
      }
      const deadline = Date.now() + 15000;
      apiTimer = setInterval(() => {
        if (cancelled || Date.now() > deadline) { clearInterval(apiTimer); return; }
        if (!apiWindow.YT?.Player) return;
        clearInterval(apiTimer);
        player = new apiWindow.YT.Player(frame, { events: {
          onReady: () => { if (!cancelled) sampleTimer = setInterval(sample, 250); },
          onStateChange: ({ data }) => {
            previousWall = 0;
            if (data === 1 && player) { previous = player.getCurrentTime(); previousWall = performance.now(); }
            if (data === 0 && player && confirmed && player.getDuration() > 0 && ranges.reduce((sum, [a, b]) => sum + b - a, 0) >= player.getDuration() * 0.99 && !milestones.has(100)) {
              milestones.add(100); emit("progress", 100);
            }
          },
        } });
      }, 100);
    };
    const onClick = (event: MouseEvent) => {
      if (confirmed && !calendarSent && event.target instanceof Element && event.target.closest('a[href="#termin"],a[data-calendar-open="true"]')) {
        calendarSent = true; emit("calendar_click");
      }
    };
    const onToggle = () => { if (!disclosure.open) { player?.pauseVideo(); previousWall = 0; } else start(); };
    disclosure.addEventListener("toggle", onToggle);
    document.addEventListener("click", onClick);
    start();
    return () => {
      cancelled = true; clearInterval(apiTimer); clearInterval(sampleTimer);
      disclosure.removeEventListener("toggle", onToggle); document.removeEventListener("click", onClick);
      player?.destroy(); container.replaceChildren();
    };
  }, [src, title]);
  return <div ref={host} />;
}
