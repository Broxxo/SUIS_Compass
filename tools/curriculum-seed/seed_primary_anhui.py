#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""小学段（G1–G6）课程与学期单元同步：严格对齐安徽省 2022 课程方案与合肥市选用教材。

流程：
1. 读取现有课程，按名称复用课程 ID（保留 G7–G11 的适用年级与周课时配置）；
2. 更新周课时（G1–G6 严格合计 26 / 30），并补建劳动、综合实践、地方课程、校本课程；
3. 逐课程 × 年级 × 学期写入 semester_data；
4. 回读校验：周次覆盖 1–9 与 11–18，第 10、19、20 周不排单元，概念全部在全局概念表内。

用法：
    python3 tools/curriculum-seed/seed_primary_anhui.py            # 写入
    python3 tools/curriculum-seed/seed_primary_anhui.py --dry-run  # 只校验不写入
    python3 tools/curriculum-seed/seed_primary_anhui.py --verify   # 只回读校验
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import primary_catalogs_a as A  # noqa: E402
import primary_catalogs_b as B  # noqa: E402
import primary_catalogs_c as C  # noqa: E402
from primary_common import (  # noqa: E402
    COURSES,
    GRADES,
    KC,
    PERIODS,
    build_units,
    semester_key,
)

API = os.environ.get("SUIS_API_URL", "http://127.0.0.1:8080/api").rstrip("/")
ADMIN_USER = os.environ.get("SUIS_ADMIN_USER", "Admin")
ADMIN_PASS = os.environ.get("SUIS_ADMIN_PASS", "Suiscompass2019!")

# 课程键 -> 现有数据库中的课程名（沿用既有 ID，避免影响排课与成绩单映射）
EXISTING_NAMES = {
    "chinese": "语文",
    "math": "数学",
    "english": "英语",
    "science": "科学",
    "daofa": "道法",
    "music": "音乐",
    "art": "美术",
    "pe": "体育",
    "it": "信息科技",
    "classmeeting": "班会",
}

# 新建课程 ID（劳动、综合实践、地方课程、校本课程此前未建）
NEW_IDS = {
    "labor": "course-primary-labor",
    "practice": "course-primary-practice",
    "local": "course-primary-local",
    "school": "course-primary-school",
}

# 对外展示名：只用学科名，课程河流不承载教材版本信息
DISPLAY_NAMES = {
    "chinese": "语文",
    "math": "数学",
    "english": "英语",
    "science": "科学",
    "daofa": "道法",
    "music": "音乐",
    "art": "美术",
    "pe": "体育",
    "it": "信息科技",
    "labor": "劳动",
    "practice": "综合实践",
    "local": "地方课程",
    "school": "校本课程",
    "classmeeting": "班会",
}

CATALOGS = {
    "chinese": A.CHINESE,
    "math": A.MATH,
    "english": A.ENGLISH,
    "science": B.SCIENCE,
    "daofa": B.DAOFA,
    "music": B.MUSIC,
    "art": B.ART,
}
CATALOGS.update(C.ALL)

WEEK_SET = set(range(1, 10)) | set(range(11, 19))
ALLOWED_CONCEPTS = set(KC.values())


def request_json(method: str, url: str, token: str | None = None, payload: dict | None = None):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:600]
        raise RuntimeError(f"{method} {url} -> {e.code}: {detail}") from e


def login() -> str:
    body = request_json("POST", f"{API}/auth/login", payload={"username": ADMIN_USER, "password": ADMIN_PASS})
    token = body.get("token")
    if not token:
        raise RuntimeError(f"login failed: {body}")
    return token


def periods_for(course_key: str, grade: int) -> int:
    return int(PERIODS[grade].get(
        {
            "chinese": "语文",
            "math": "数学",
            "english": "英语",
            "science": "科学",
            "daofa": "道法",
            "music": "音乐",
            "art": "美术",
            "pe": "体育",
            "it": "信息科技",
            "labor": "劳动",
            "practice": "综合实践",
            "local": "地方课程",
            "school": "校本课程",
            "classmeeting": "班会",
        }[course_key],
        0,
    ))


def week_span(week: str) -> int:
    if "-" in week:
        a, b = week.split("-")
        return int(b) - int(a) + 1
    return 1


def week_numbers(week: str) -> set[int]:
    text = str(week or "").strip()
    if not text:
        return set()
    if "-" in text:
        a, b = text.split("-", 1)
        return set(range(int(a), int(b) + 1))
    return {int(text)}


def build_semester_units(course_key: str, grade: int, semester: str) -> list[dict]:
    raw = CATALOGS[course_key][(grade, semester)]
    weekly = periods_for(course_key, grade)
    if weekly <= 0:
        raise RuntimeError(f"{course_key} G{grade} 周课时为 0，不应排单元")
    units = build_units(course_key, grade, semester, raw, weekly)
    for u in units:
        u["id"] = f"unit-{course_key}-g{grade}-s{semester_key(semester)}-{u['order']}"
        u["periods"] = week_span(u["week"]) * weekly
    return units


def validate_local() -> list[str]:
    problems: list[str] = []
    for key, _name, _zh, _en, _ver, _color, grades in COURSES:
        if key not in CATALOGS:
            problems.append(f"缺少目录：{key}")
            continue
        for grade in grades:
            for semester in ("Semester 1", "Semester 2"):
                if (grade, semester) not in CATALOGS[key]:
                    problems.append(f"缺少单元：{key} G{grade} {semester}")
                    continue
                units = build_semester_units(key, grade, semester)
                covered: set[int] = set()
                for u in units:
                    covered |= week_numbers(u["week"])
                    if not u["title"] or not u["focus"]:
                        problems.append(f"空标题/重点：{u['id']}")
                    for c in u["keyConcepts"]:
                        if c not in ALLOWED_CONCEPTS:
                            problems.append(f"未知概念 {c!r}：{u['id']}")
                if covered != WEEK_SET:
                    problems.append(f"周次覆盖异常 {key} G{grade} {semester}: {sorted(covered)}")
    # 周课时合计
    for grade in GRADES:
        total = sum(PERIODS[grade].values())
        if (grade <= 2 and total != 26) or (grade >= 3 and total != 30):
            problems.append(f"G{grade} 周课时合计 {total} 不符合省定 {26 if grade <= 2 else 30}")
    return problems


def merge_periods(existing: dict, updates: dict) -> dict:
    merged = dict(existing or {})
    merged.update(updates)
    return merged


def sync_courses(token: str) -> dict[str, str]:
    courses = request_json("GET", f"{API}/courses", token=token)
    by_name = {str(c.get("name", "")).strip(): c for c in courses}
    id_map: dict[str, str] = {}
    for key, _name, zh, en, _version, color, grades in COURSES:
        display = DISPLAY_NAMES[key]
        existing = by_name.get(EXISTING_NAMES.get(key, display))
        weekly = {f"g{g}": periods_for(key, g) for g in grades}
        if existing:
            course_id = str(existing["id"])
            applicable = list(existing.get("applicableGrades") or [])
            for g in grades:
                tag = f"g{g}"
                if tag not in applicable:
                    applicable.append(tag)
            payload = {
                "id": course_id,
                "name": display,
                "subjectCategory": existing.get("subjectCategory") or {"zh": zh, "en": en},
                "applicableGrades": applicable,
                "weeklyPeriodsByGrade": merge_periods(existing.get("weeklyPeriodsByGrade") or {}, weekly),
                "color": existing.get("color") or color,
                "coTeaching": bool(existing.get("coTeaching")),
                "excludeFromStaffing": bool(existing.get("excludeFromStaffing")),
            }
        else:
            course_id = NEW_IDS[key]
            payload = {
                "id": course_id,
                "name": display,
                "subjectCategory": {"zh": zh, "en": en},
                "applicableGrades": [f"g{g}" for g in grades],
                "weeklyPeriodsByGrade": weekly,
                "color": color,
                "coTeaching": False,
                "excludeFromStaffing": False,
            }
        saved = request_json("POST", f"{API}/courses", token=token, payload=payload)
        id_map[key] = str(saved.get("id") or course_id)
        print(f"COURSE {key:14s} -> {id_map[key]}  {display}")
    return id_map


def push_semesters(token: str, id_map: dict[str, str]) -> int:
    ok = 0
    for key, _name, _zh, _en, _ver, _color, grades in COURSES:
        course_id = id_map[key]
        for grade in grades:
            for semester in ("Semester 1", "Semester 2"):
                units = build_semester_units(key, grade, semester)
                request_json(
                    "POST",
                    f"{API}/semester",
                    token=token,
                    payload={"courseId": course_id, "grade": grade, "semester": semester, "units": units},
                )
                ok += 1
                print(f"  OK {key:14s} G{grade} {semester}: {len(units):2d} units | "
                      f"{' / '.join(u['week'] for u in units)}")
    return ok


def verify_remote(token: str, id_map: dict[str, str]) -> list[str]:
    problems: list[str] = []
    for key, _name, _zh, _en, _ver, _color, grades in COURSES:
        course_id = id_map[key]
        for grade in grades:
            for semester in ("Semester 1", "Semester 2"):
                url = f"{API}/semester/{course_id}/{grade}/{urllib.parse.quote(semester)}"
                data = request_json("GET", url, token=token)
                units = data.get("units") or []
                expect = build_semester_units(key, grade, semester)
                if len(units) != len(expect):
                    problems.append(f"{key} G{grade} {semester}: 单元数 {len(units)} != {len(expect)}")
                    continue
                covered: set[int] = set()
                for u in units:
                    wk = str(u.get("week", ""))
                    covered |= week_numbers(wk)
                    for c in u.get("keyConcepts") or []:
                        if c not in ALLOWED_CONCEPTS:
                            problems.append(f"{key} G{grade} {semester}: 未知概念 {c!r}")
                if covered != WEEK_SET:
                    problems.append(f"{key} G{grade} {semester}: 周次覆盖 {sorted(covered)}")
                if 10 in covered or 19 in covered or 20 in covered:
                    problems.append(f"{key} G{grade} {semester}: 评估周被占用")
    return problems


def main() -> int:
    dry = "--dry-run" in sys.argv
    only_verify = "--verify" in sys.argv

    problems = validate_local()
    if problems:
        print("本地校验未通过：", file=sys.stderr)
        for p in problems:
            print("  -", p, file=sys.stderr)
        return 1
    print(f"本地校验通过：{len(COURSES)} 门课程 × G1–G6 × 两学期，周次严格覆盖 1–9、11–18。")

    token = login()
    id_map = {key: (NEW_IDS.get(key) or "") for key, *_ in COURSES}
    if not only_verify:
        if dry:
            print("dry-run：跳过写入。")
        else:
            id_map = sync_courses(token)
            n = push_semesters(token, id_map)
            print(f"写入完成：{n} 个学期。")

    if any(not v for v in id_map.values()):
        # verify 模式：按名称查回 ID
        courses = request_json("GET", f"{API}/courses", token=token)
        by_name = {str(c.get("name", "")).strip(): c for c in courses}
        for key, *_ in COURSES:
            hit = by_name.get(DISPLAY_NAMES[key])
            if hit:
                id_map[key] = str(hit["id"])

    remote = verify_remote(token, id_map)
    if remote:
        print("回读校验未通过：", file=sys.stderr)
        for p in remote:
            print("  -", p, file=sys.stderr)
        return 1
    print("回读校验通过：全部学期单元、周次与概念一致。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
