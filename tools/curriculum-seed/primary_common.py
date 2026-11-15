#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""小学段（G1–G6）公共框架：课程表、课时分配、周次切分、单元构造。

依据：
- 《义务教育课程方案和课程标准（2022年版）》
- 《安徽省义务教育课程实施办法》（皖教基〔2022〕）附件1/2/3
- 合肥市选用教材版本（2024年秋季起起始年级启用2022课标修订教材）
- 协和双语学校（SUIS）双语特色：英语自 G1 起开设（省办法允许一至二年级
  开设外语实验，每周不多于2课时），计入校本/外语实验课时。
"""
from __future__ import annotations

KC = {
    "审美": "审美 Aesthetics",
    "变化": "变化 Change",
    "交流": "交流 Communication",
    "社区": "社区 Communities",
    "关联": "关联 Connections",
    "创造力": "创造力 Creativity",
    "文化": "文化 Culture",
    "发展": "发展 Development",
    "形式": "形式 Form",
    "全球": "全球互动 Global interactions",
    "身份": "身份认同 Identity",
    "逻辑": "逻辑 Logic",
    "视角": "视角 Perspective",
    "关系": "关系 Relationships",
    "时空": "时间/地点/空间 Time/place/space",
    "系统": "系统 Systems",
}

# 教学周：第10周期中评估、第19周期末评估，第20周机动/复习，均不排单元。
TEACHING_WEEKS_1 = [1, 2, 3, 4, 5, 6, 7, 8, 9]
TEACHING_WEEKS_2 = [11, 12, 13, 14, 15, 16, 17, 18]

GRADES = [1, 2, 3, 4, 5, 6]

# 周课时（严格合计 26 / 30，符合安徽省附件2区间）
# G1–2：语文6 数学3 英语2 科学1 道法2 体育4 音乐2 美术2 劳动1 综合1 校本1 班会1 = 26
# G3–4：道法2 语文6 数学4 英语2 科学2 信息1 体育4 音乐2 美术2 劳动1 综合1 地方1 校本1 班会1 = 30
# G5–6：道法2 语文6 数学5 英语3 科学2 信息1 体育3 音乐2 美术1 劳动1 综合1 地方1 校本1 班会1 = 30
PERIODS = {
    1: {"语文": 6, "数学": 3, "英语": 2, "科学": 1, "道法": 2, "体育": 4,
        "音乐": 2, "美术": 2, "劳动": 1, "综合实践": 1, "地方课程": 0,
        "校本课程": 1, "班会": 1, "信息科技": 0},
    2: {"语文": 6, "数学": 3, "英语": 2, "科学": 1, "道法": 2, "体育": 4,
        "音乐": 2, "美术": 2, "劳动": 1, "综合实践": 1, "地方课程": 0,
        "校本课程": 1, "班会": 1, "信息科技": 0},
    3: {"语文": 6, "数学": 4, "英语": 2, "科学": 2, "道法": 2, "体育": 4,
        "音乐": 2, "美术": 2, "劳动": 1, "综合实践": 1, "地方课程": 1,
        "校本课程": 1, "班会": 1, "信息科技": 1},
    4: {"语文": 6, "数学": 4, "英语": 2, "科学": 2, "道法": 2, "体育": 4,
        "音乐": 2, "美术": 2, "劳动": 1, "综合实践": 1, "地方课程": 1,
        "校本课程": 1, "班会": 1, "信息科技": 1},
    5: {"语文": 6, "数学": 5, "英语": 3, "科学": 2, "道法": 2, "体育": 3,
        "音乐": 2, "美术": 1, "劳动": 1, "综合实践": 1, "地方课程": 1,
        "校本课程": 1, "班会": 1, "信息科技": 1},
    6: {"语文": 6, "数学": 5, "英语": 3, "科学": 2, "道法": 2, "体育": 3,
        "音乐": 2, "美术": 1, "劳动": 1, "综合实践": 1, "地方课程": 1,
        "校本课程": 1, "班会": 1, "信息科技": 1},
}

# 课程定义：(键, 课程名, 学科分类zh, 分类en, 教材版本, 颜色, 适用年级)
COURSES = [
    ("chinese", "语文-统编版", "语文", "Chinese", "统编版（2024）", "light-green", GRADES),
    ("math", "数学-苏教版", "数学", "Math", "苏教版（2024）", "light-yellow", GRADES),
    ("english", "英语-PEP", "英语", "English", "人教PEP（2024）一年级起点", "light-blue", GRADES),
    ("science", "科学-教科版", "科学", "Science", "教科版（2024）", "light-teal", GRADES),
    ("daofa", "道法-统编版", "道法", "Morality & Law", "统编版（2024）", "light-amber", GRADES),
    ("music", "音乐-人音版", "音乐", "Music", "人音版（2024）", "light-rose", GRADES),
    ("art", "美术-人美版", "美术", "Art", "人美版（2024）", "light-fuchsia", GRADES),
    ("pe", "体育与健康-SUIS", "体育", "PE & Health", "人教版（2024）＋SUIS校本", "light-stone", GRADES),
    ("it", "信息科技-安徽指南", "信息科技", "IT", "安徽省义务教育信息科技教学指南（2024）", "light-orange", [3, 4, 5, 6]),
    ("labor", "劳动-安教社", "劳动", "Labour", "安教社《劳动教育》", "light-lime", GRADES),
    ("practice", "综合实践活动-安教社", "综合实践", "Integrated Practice", "安教社《综合实践活动》", "light-purple", GRADES),
    ("local", "地方课程-安徽", "地方课程", "Local Curriculum", "安徽省地方课程（生活教育·热爱家乡·科技创新·学段衔接）", "light-red", [3, 4, 5, 6]),
    ("school", "校本课程-SUIS", "校本课程", "School-based", "SUIS 双语融合课程", "light-cyan", GRADES),
    ("classmeeting", "班会-SUIS", "班会", "Class Meeting", "SUIS 德育课程", "light-pink", GRADES),
]


def _even(total: int, parts: int) -> list[int]:
    base, rem = divmod(total, parts)
    return [base + (1 if i < rem else 0) for i in range(parts)]


def _distribute(total: int, weights: list[float]) -> list[int]:
    """按权重把 total 个周分给若干单元，每个单元至少 1 周，合计恰好 total。"""
    n = len(weights)
    if n == 0:
        return []
    if n >= total:
        return [1] * total if n == total else [1] * total
    w = [max(0.1, float(x)) for x in weights]
    s = sum(w)
    raw = [max(1.0, total * x / s) for x in w]
    # 以最大余数法归整到 total
    floor = [int(x) for x in raw]
    deficit = total - sum(floor)
    order = sorted(range(n), key=lambda i: raw[i] - floor[i], reverse=True)
    i = 0
    while deficit > 0:
        floor[order[i % n]] += 1
        deficit -= 1
        i += 1
    while deficit < 0:
        # 从最大值开始回收，保证不少于 1
        idx = sorted(range(n), key=lambda i: floor[i], reverse=True)
        for j in idx:
            if floor[j] > 1:
                floor[j] -= 1
                deficit += 1
                break
    return floor


def plan_weeks(weights: list[float]) -> list[str]:
    """把单元按权重排入 1–9 周与 11–18 周，返回 ['1-2','3-4',...]。"""
    n = len(weights)
    if n == 1:
        return ["1-9"]
    w = [max(0.1, float(x)) for x in weights]
    total = sum(w)
    # 以累计权重最接近 9/17 的位置作为期中分界，两侧各自至少 1 个单元
    best_k = 1
    best_gap = None
    acc = 0.0
    for i in range(n - 1):
        acc += w[i]
        gap = abs(acc / total - 9.0 / 17.0)
        if best_gap is None or gap < best_gap:
            best_gap = gap
            best_k = i + 1
    n_left = max(1, min(n - 1, min(best_k, 9)))
    if n - n_left > 8:
        n_left = n - 8
    left = _distribute(9, weights[:n_left])
    right = _distribute(8, weights[n_left:])

    out: list[str] = []
    cursor = 0
    for size in left:
        seg = TEACHING_WEEKS_1[cursor:cursor + size]
        out.append(f"{seg[0]}-{seg[-1]}" if len(seg) > 1 else str(seg[0]))
        cursor += size
    cursor = 0
    for size in right:
        seg = TEACHING_WEEKS_2[cursor:cursor + size]
        out.append(f"{seg[0]}-{seg[-1]}" if len(seg) > 1 else str(seg[0]))
        cursor += size
    return out


def week_len(week: str) -> int:
    if "-" in week:
        a, b = week.split("-")
        return int(b) - int(a) + 1
    return 1


def build_units(course_key: str, grade: int, semester: str, raw: list[tuple],
                weekly_periods: int) -> list[dict]:
    """raw: [(title_zh, title_en, focus_zh, focus_en, [概念...], weight), ...]"""
    weights = [r[5] for r in raw]
    weeks = plan_weeks(weights)
    units = []
    for i, (tzh, ten, fzh, fen, concepts, _w) in enumerate(raw):
        title = f"{tzh} / {ten}" if ten else tzh
        parts = [p for p in fzh.split("；") if p.strip()]
        content = parts[0]
        emphasis = "；".join(parts[1:]) or "围绕单元大概念完成探究与迁移应用"
        focus = f"主要内容：{content}。学习重点：{emphasis}。"
        if fen:
            focus += f" Main content: {fen}"
        wk = weeks[i]
        units.append({
            "id": f"unit-{course_key}-g{grade}-s{semester[-1]}-{i}",
            "week": wk,
            "focus": focus,
            "order": i,
            "title": title,
            "periods": week_len(wk) * weekly_periods,
            "keyConcepts": [KC[c] for c in concepts],
        })
    return units


def semester_key(semester: str) -> str:
    return "1" if semester == "Semester 1" else "2"
