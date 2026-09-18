#!/usr/bin/env python3
"""杨百万B站数据看板采集脚本。

- 视频列表从 GitHub raw URL 动态拉取（每次采集时同步，增删 BV 自动生效）
- 每 30 分钟由 server.py 调用一次，输出静态 JSON 供看板展示
- 只保留主列表，无测试列表
"""
import argparse
import json
import os
import time
import urllib.request
import urllib.parse
from datetime import datetime
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Shanghai")
ROOT = os.path.dirname(os.path.abspath(__file__))
# GitHub Pages 从仓库根目录部署，前端 index.html/app.js/latest.json 都在根目录，
# 故 latest.json 直接写到根目录（不再用 web/ 子目录）。
WEB_DIR = ROOT
DATA_DIR = os.path.join(ROOT, "data")
DATA_FILE = os.path.join(DATA_DIR, "data.json")

# GitHub 视频列表（纯文本，每行一个 BV 号）。
# 服务器无法直连 raw.githubusercontent.com（被墙），用 jsDelivr CDN 代理作为主源，
# raw 作为备用源（本地开发可达、且比 CDN 更实时）。
VIDEO_LIST_URLS = [
    "https://cdn.jsdelivr.net/gh/ldmpp0308/only-bowen@main/"
    "YBW-%E6%95%B0%E6%8D%AE%E7%9C%8B%E6%9D%BF%E5%88%97%E8%A1%A8",
    "https://raw.githubusercontent.com/ldmpp0308/only-bowen/refs/heads/main/"
    "YBW-%E6%95%B0%E6%8D%AE%E7%9C%8B%E6%9D%BF%E5%88%97%E8%A1%A8",
]
VIDEO_LIST_CACHE = os.path.join(ROOT, "video_list_cache.json")
LATEST_FILE = os.path.join(WEB_DIR, "latest.json")

METRICS = ["view", "online", "share", "like", "favorite", "coin", "reply", "danmaku"]
METRIC_NAMES = {
    "online": "在线人数",
    "view": "播放",
    "share": "分享",
    "like": "点赞",
    "favorite": "收藏",
    "coin": "投币",
    "reply": "评论",
    "danmaku": "弹幕",
}

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
HEADERS = {
    "User-Agent": UA,
    "Referer": "https://www.bilibili.com/",
    "Accept": "application/json, text/plain, */*",
}


def _num(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _get(url, timeout=15):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _parse_video_list(raw):
    """解析云端视频列表：支持 JSON（对象/数组）或每行一个 BV 号的纯文本。"""
    raw = (raw or "").strip()
    if not raw:
        return []
    videos = []
    try:
        data = json.loads(raw)
        items = data.get("videos", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
        for it in items:
            if isinstance(it, str):
                bvid = it.strip()
                if bvid:
                    videos.append({"bvid": bvid, "title": ""})
            elif isinstance(it, dict):
                bvid = (it.get("bvid") or "").strip()
                if bvid:
                    videos.append({"bvid": bvid, "title": it.get("title") or ""})
        return videos
    except (json.JSONDecodeError, ValueError):
        pass
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        for token in line.replace(",", " ").replace("，", " ").split():
            token = token.strip()
            if token.upper().startswith("BV"):
                videos.append({"bvid": token, "title": ""})
    return videos


def read_config():
    """从多个镜像源拉取视频列表，失败时回退本地缓存。"""
    for url in VIDEO_LIST_URLS:
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=20) as resp:
                raw = resp.read().decode("utf-8")
            videos = _parse_video_list(raw)
            if videos:
                with open(VIDEO_LIST_CACHE, "w", encoding="utf-8") as f:
                    json.dump({"videos": videos}, f, ensure_ascii=False, indent=2)
                return videos
        except Exception:
            continue
    try:
        with open(VIDEO_LIST_CACHE, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        return cfg.get("videos", []) if isinstance(cfg, dict) else []
    except FileNotFoundError:
        return []


def load_store():
    os.makedirs(DATA_DIR, exist_ok=True)
    config_videos = read_config()
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            store = json.load(f)
    else:
        store = {"videos": [], "lastCollect": 0}

    if not config_videos:
        # GitHub 和本地缓存都不可用，保留已有 store 的视频列表，避免清空历史
        store["lastCollect"] = store.get("lastCollect") or 0
        return store

    by_bvid = {v["bvid"]: v for v in store.get("videos", [])}
    videos = []
    for cfg in config_videos:
        bvid = cfg.get("bvid") or ""
        if not bvid:
            continue
        existed = by_bvid.get(bvid)
        if existed:
            existed["title"] = cfg.get("title") or existed.get("title") or bvid
            videos.append(existed)
        else:
            videos.append({"bvid": bvid, "title": cfg.get("title") or bvid, "history": []})
    store["videos"] = videos
    store["lastCollect"] = store.get("lastCollect") or 0
    return store


def persist_store(store):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(store, f, ensure_ascii=False, indent=2)


def fetch_video_metrics(bvid):
    view_url = "https://api.bilibili.com/x/web-interface/view?bvid=" + urllib.parse.quote(bvid)
    view_json = _get(view_url)
    if view_json.get("code") != 0:
        raise RuntimeError(f"view 接口错误 code={view_json.get('code')} msg={view_json.get('message')}")
    data = view_json.get("data") or {}
    stat = data.get("stat") or {}
    owner = (data.get("owner") or {}).get("name") or ""

    result = {
        "bvid": bvid,
        "title": data.get("title") or bvid,
        "owner": owner,
        "aid": data.get("aid"),
        "cid": data.get("cid") or ((data.get("pages") or [{}])[0].get("cid") if data.get("pages") else 0),
        "view": _num(stat.get("view")),
        "share": _num(stat.get("share")),
        "like": _num(stat.get("like")),
        "favorite": _num(stat.get("favorite")),
        "coin": _num(stat.get("coin")),
        "reply": _num(stat.get("reply")),
        "danmaku": _num(stat.get("danmaku")),
        "online": 0,
    }

    try:
        online_url = (
            "https://api.bilibili.com/x/player/online/total?aid=%s&bvid=%s&cid=%s"
            % (result["aid"], urllib.parse.quote(bvid), result["cid"])
        )
        online_json = _get(online_url)
        if online_json.get("code") == 0:
            result["online"] = _num((online_json.get("data") or {}).get("total"))
    except Exception:
        result["online"] = 0

    return result


def _collect(store, persist_fn):
    timestamp = int(time.time())
    videos = store["videos"]
    results = []
    errors = []

    for v in videos:
        result = None
        last_err = None
        for attempt in range(3):  # 1 次正常 + 2 次重试，规避 B站偶发限流/超时
            try:
                result = fetch_video_metrics(v["bvid"])
                break
            except Exception as e:
                last_err = str(e)
                time.sleep(1.0)
        if result is not None:
            results.append(result)
        else:
            errors.append({"bvid": v["bvid"], "error": last_err or "unknown"})
        time.sleep(1.2)  # 拉长请求间隔，降低触发 B站限流的概率

    result_map = {r["bvid"]: r for r in results}
    for v in videos:
        m = result_map.get(v["bvid"])
        if not m:
            continue
        if m.get("title"):
            v["title"] = m["title"]
        if m.get("owner"):
            v["owner"] = m["owner"]
        point = {"t": timestamp}
        for key in METRICS:
            point[key] = m[key]
        v.setdefault("history", []).append(point)

    store["lastCollect"] = timestamp
    persist_fn(store)
    return timestamp, len(results), len(errors), errors


def _local_date_key(t):
    d = datetime.fromtimestamp(t, tz=TZ)
    return "%04d-%02d-%02d" % (d.year, d.month, d.day)


def _day_view_delta(v):
    h = v.get("history") or []
    if not h:
        return 0
    last = h[-1]
    last_date = _local_date_key(last["t"])
    base = None
    for p in h:
        if _local_date_key(p["t"]) == last_date:
            base = p
            break
    if not base:
        return 0
    return _num(last.get("view")) - _num(base.get("view"))


def compute_top(store):
    interval = None
    today = None
    for v in store["videos"]:
        h = v.get("history") or []
        if len(h) >= 2:
            delta = _num(h[-1].get("view")) - _num(h[-2].get("view"))
            if interval is None or delta > interval["delta"]:
                interval = {"bvid": v["bvid"], "title": v["title"], "owner": v.get("owner") or "", "delta": delta}
        delta_today = _day_view_delta(v)
        if today is None or delta_today > today["delta"]:
            today = {"bvid": v["bvid"], "title": v["title"], "owner": v.get("owner") or "", "delta": delta_today}
    return {"interval": interval, "today": today}


def compute_totals(store):
    videos = store["videos"]
    totals = {}
    for key in METRICS:
        totals[key] = 0
        totals[key + "Delta"] = 0
        totals[key + "Total"] = 0
    for v in videos:
        h = v.get("history") or []
        if not h:
            continue
        cur = h[-1]
        prev = h[-2] if len(h) > 1 else cur
        first = h[0]
        for key in METRICS:
            totals[key] += _num(cur.get(key))
            totals[key + "Delta"] += _num(cur.get(key)) - _num(prev.get(key))
            totals[key + "Total"] += _num(cur.get(key)) - _num(first.get(key))
    return totals


def write_latest(store):
    os.makedirs(WEB_DIR, exist_ok=True)
    payload = {
        "metrics": METRICS,
        "metricNames": METRIC_NAMES,
        "videos": [
            {
                "bvid": v["bvid"],
                "title": v["title"],
                "owner": v.get("owner") or "",
                "history": v.get("history") or [],
            }
            for v in store["videos"]
        ],
        "totals": compute_totals(store),
        "top": compute_top(store),
        "lastCollect": store.get("lastCollect") or 0,
        "collecting": False,
        "videoCount": len(store["videos"]),
    }
    with open(LATEST_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def main():
    store = load_store()
    timestamp, ok, failed, errors = _collect(store, persist_store)
    write_latest(store)
    ts = datetime.fromtimestamp(timestamp, tz=TZ).isoformat(timespec="seconds")
    if failed:
        print(f"[{ts}] [BILI] 采集完成: 成功 {ok}, 失败 {failed}; 失败明细: {errors}")
    else:
        print(f"[{ts}] [BILI] 采集完成: 成功 {ok}, 失败 {failed}")


if __name__ == "__main__":
    # 兼容 server.py 的统一调用参数（--mode/--artists/--out），实际不使用
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", default="snapshot")
    parser.add_argument("--artists", default="")
    parser.add_argument("--out", default="")
    parser.parse_known_args()
    main()
