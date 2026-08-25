#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
逐学期写入数学 G1–G9：
- G1–G6 → 课程「数学-苏教版」
- G7–G9 → 课程「数学-沪科版」（学校 G9 = grade 9）

不走 curriculum/import 整包覆盖。周次：16 个教学周（跳过第 9、18 周）。
课时按课程已设周课时：苏教 G1–4 为 5，G5–6 为 6；沪科 G7–8 为 6，G9 为 7。
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

API = os.environ.get("SUIS_API_URL", "http://127.0.0.1:8080/api").rstrip("/")
ADMIN_USER = os.environ.get("SUIS_ADMIN_USER", "Admin")
ADMIN_PASS = os.environ.get("SUIS_ADMIN_PASS", "4321")

COURSE_SJB_NAME = os.environ.get("SUIS_MATH_SJB_COURSE", "数学-苏教版")
COURSE_HKB_NAME = os.environ.get("SUIS_MATH_HKB_COURSE", "数学-沪科版")

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

TEACHING_WEEKS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17]


def weekly_periods(grade: int) -> int:
    if grade <= 4:
        return 5
    if grade <= 6:
        return 6
    if grade <= 8:
        return 6
    return 7  # G9 / g10


def format_week(chunk: list[int]) -> str:
    if len(chunk) == 1:
        return str(chunk[0])
    return f"{chunk[0]}-{chunk[-1]}"


def _even(total: int, parts: int) -> list[int]:
    base, rem = divmod(total, parts)
    return [base + (1 if i < rem else 0) for i in range(parts)]


def split_weeks(n: int) -> list[str]:
    if n <= 0:
        raise ValueError("unit count")
    n_left = max(1, min(n - 1, (n + 1) // 2))
    n_right = n - n_left
    sizes = _even(8, n_left) + _even(8, n_right)
    chunks: list[str] = []
    i = 0
    for sz in sizes:
        chunk = TEACHING_WEEKS[i : i + sz]
        if not chunk:
            raise RuntimeError("empty week chunk")
        covered = list(range(chunk[0], chunk[-1] + 1))
        if covered != chunk:
            raise RuntimeError(f"week gap inside {chunk}")
        chunks.append(format_week(chunk))
        i += sz
    if i != 16:
        raise RuntimeError(f"week coverage {i}")
    return chunks


def week_span(week: str) -> int:
    if "-" in week:
        a, b = week.split("-")
        return int(b) - int(a) + 1
    return 1


def unit(title: str, content: str, task: str, extra: str, *concepts: str) -> dict:
    focus = f"主要内容：{content}。学习重点：{task}"
    en = extra.strip()
    if en:
        focus = f"{focus} {en}"
    return {
        "title": title,
        "focus": focus,
        "keyConcepts": [KC[c] for c in concepts],
    }


# grade -> semester -> units
SJB: dict[int, dict[str, list[dict]]] = {
    1: {
        "Semester 1": [
            unit("0～5 的认识和加减法", "0～5 各数的意义、分与合；5 以内加减；综合实践：数学游戏分享",
                 "在数数、比较中建立数感，用分与合理解加减，能正确计算 5 以内加减法。",
                 "Build number sense for 0–5 and addition/subtraction within 5.",
                 "形式", "逻辑"),
            unit("图形的初步认识（一）", "长方体、正方体、圆柱、球；上下、前后、左右；综合实践：生活中的位置",
                 "直观认识常见立体图形，能用方位词描述物体位置。",
                 "Recognise 3D shapes and describe position with everyday language.",
                 "形式", "时空"),
            unit("6～9 的认识和加减法", "6～9 的组成；6～9 的加减；连加、连减、加减混合",
                 "掌握 6～9 的分与合，正确计算相关加减，体会运算顺序。",
                 "Compose and compute with numbers 6–9.",
                 "逻辑", "关系"),
            unit("10 的认识和加减法", "10 的组成；10 以内加减；综合实践：好玩的抢“10”",
                 "熟练 10 的分与合，为 20 以内进位加法做准备。",
                 "Master making 10 as a foundation for later addition.",
                 "系统", "逻辑"),
            unit("认识 11～19", "11～19 的组成（十和几）；不进位的十几加几、不退位的十几减几",
                 "理解十进制计数单位“十”，能计算不进位、不退位的十几加减。",
                 "Understand tens and ones in 11–19 without regrouping.",
                 "形式", "系统"),
        ],
        "Semester 2": [
            unit("20 以内的进位加法", "9 加几、8 加几等到 2 加几；凑十法",
                 "用凑十法正确计算 20 以内进位加法，并能解决简单实际问题。",
                 "Use making-ten to add within 20.",
                 "逻辑", "系统"),
            unit("20 以内的退位减法", "十几减 9、减 8 等到减 2；破十法、想加算减",
                 "掌握 20 以内退位减法，沟通加减关系。",
                 "Subtract within 20 by breaking ten or thinking of addition.",
                 "关系", "逻辑"),
            unit("认识图形（二）", "长方形、正方形、三角形、圆；平面图形的拼组",
                 "从立体图形中抽象平面图形，能辨认和简单拼组。",
                 "Identify plane shapes and compose simple figures.",
                 "形式", "审美"),
            unit("认识 100 以内的数", "数数、读数写数、数的组成与大小比较；整十数加减",
                 "建立百以内数位概念，比较大小，计算整十数加减。",
                 "Read, write and compare numbers to 100.",
                 "形式", "系统"),
            unit("100 以内的加法和减法（一）", "两位数加、减一位数或整十数（不进位、不退位及简单进退位）",
                 "理解相同数位对齐，正确口算和笔算。",
                 "Add and subtract within 100 with place-value alignment.",
                 "逻辑", "系统"),
            unit("元、角、分", "认识人民币；简单购物与换算；小小商店",
                 "认识人民币单位，进行简单兑换与购物计算。",
                 "Use yuan, jiao and fen in simple shopping.",
                 "社区", "关联"),
            unit("100 以内的加法和减法（二）", "两位数加两位数、两位数减两位数；连加连减",
                 "掌握进位加、退位减，能解决两步简单问题。",
                 "Compute two-digit addition and subtraction, including regrouping.",
                 "逻辑", "发展"),
        ],
    },
    2: {
        "Semester 1": [
            unit("100 以内的加法和减法（三）", "两位数加减两位数的整理；估算；解决问题",
                 "灵活选择口算、笔算和估算，提高计算正确率。",
                 "Consolidate addition and subtraction within 100.",
                 "逻辑", "系统"),
            unit("平行四边形的初步认识", "平行四边形的直观认识；有趣的七巧板",
                 "从边的特点认识平行四边形，用七巧板拼图形。",
                 "Recognise parallelograms and compose tangram pictures.",
                 "形式", "创造力"),
            unit("表内乘法（一）", "乘法的意义；1～6 的乘法口诀；乘法各部分名称",
                 "理解乘法是同数连加的简便运算，熟记 1～6 的口诀。",
                 "Understand multiplication and memorise facts 1–6.",
                 "关系", "逻辑"),
            unit("表内除法（一）", "除法的意义（平均分、包含除）；用 1～6 的口诀求商",
                 "理解除法与乘法的关系，能用口诀求商。",
                 "Link division to multiplication and find quotients with facts 1–6.",
                 "关系", "逻辑"),
            unit("厘米和米", "认识厘米、米；测量与估测；我们身体上的“尺”",
                 "建立长度观念，会用尺测量，知道 1 米=100 厘米。",
                 "Measure length in centimetres and metres.",
                 "形式", "时空"),
            unit("表内乘法和表内除法（二）", "7～9 的乘法口诀及用口诀求商；乘加、乘减",
                 "完成表内乘除法，能解决简单乘除实际问题。",
                 "Complete multiplication facts 7–9 and related division.",
                 "系统", "逻辑"),
            unit("观察物体", "从前面、后面、上面观察简单物体",
                 "能辨认从不同方向看到的形状，发展空间观念。",
                 "Identify views of objects from front, back and above.",
                 "视角", "时空"),
        ],
        "Semester 2": [
            unit("有余数的除法", "有余数除法的意义、竖式；余数要比除数小；平均分有剩余的问题",
                 "理解余数的含义，正确计算表内有余数除法。",
                 "Interpret and compute division with remainders.",
                 "逻辑", "形式"),
            unit("时、分、秒", "认识钟面；时分秒的关系；简单经过时间",
                 "会看整时、几时几分，知道 1 时=60 分、1 分=60 秒。",
                 "Read clocks and relate hours, minutes and seconds.",
                 "时空", "系统"),
            unit("认识方向", "东、南、西、北；根据给定方向判断物体位置；测定方向",
                 "在现实情境中辨认四个方向。",
                 "Use the four cardinal directions to locate objects.",
                 "时空", "社区"),
            unit("认识万以内的数", "千以内、万以内数的读写真值；算盘；大小比较与近似数",
                 "理解十进制计数法，能读写、比较万以内的数。",
                 "Read, write and compare numbers to 10,000.",
                 "形式", "系统"),
            unit("分米和毫米", "认识分米、毫米；长度单位换算与选择",
                 "知道米、分米、厘米、毫米的进率，能合理选用单位。",
                 "Use decimetres and millimetres with metric conversions.",
                 "形式", "关系"),
            unit("两、三位数的加法和减法", "口算与笔算；连加连减与加减混合；估算",
                 "掌握三位数加减法，能解决简单实际问题。",
                 "Add and subtract two- and three-digit numbers.",
                 "逻辑", "系统"),
            unit("角的初步认识", "角的各部分名称；直角、锐角、钝角；用三角板判断直角",
                 "直观认识角，能辨认直角、锐角和钝角。",
                 "Identify right, acute and obtuse angles.",
                 "形式", "审美"),
            unit("数据的收集和整理（一）", "简单统计；以一当一的象形统计图；了解你的好朋友",
                 "经历收集、整理数据，用简单统计图表呈现结果。",
                 "Collect and display simple data.",
                 "交流", "系统"),
        ],
    },
    3: {
        "Semester 1": [
            unit("两、三位数乘一位数", "口算、笔算、估算；中间或末尾有 0 的乘法；连乘",
                 "掌握两三位数乘一位数，能解决简单实际问题。",
                 "Multiply two- and three-digit numbers by one-digit numbers.",
                 "逻辑", "系统"),
            unit("千克和克", "认识千克、克；用秤称重；1 千克=1000 克",
                 "建立质量观念，能选择合适单位并简单换算。",
                 "Measure mass in kilograms and grams.",
                 "形式", "关联"),
            unit("长方形和正方形", "特征；周长的含义与计算；周长是多少",
                 "理解周长，会计算长方形、正方形的周长。",
                 "Find perimeters of rectangles and squares.",
                 "形式", "逻辑"),
            unit("两、三位数除以一位数", "口算、笔算、估算；有余数除法；用乘法验算",
                 "掌握两三位数除以一位数，理解商的位数。",
                 "Divide two- and three-digit numbers by one-digit numbers.",
                 "逻辑", "关系"),
            unit("解决问题的策略", "从条件出发思考；间隔排列",
                 "用画图、列举等方法解决间隔等问题。",
                 "Use diagrams and listing to solve interval problems.",
                 "逻辑", "创造力"),
            unit("平移、旋转和轴对称", "平移、旋转现象；轴对称图形",
                 "认识运动现象，能辨认轴对称图形。",
                 "Identify translation, rotation and line symmetry.",
                 "变化", "审美"),
            unit("分数的初步认识（一）", "几分之一、几分之几；简单比较；多彩的“分数条”",
                 "理解分数的含义，能读写和比较简单分数。",
                 "Understand unit fractions and simple non-unit fractions.",
                 "形式", "关系"),
        ],
        "Semester 2": [
            unit("两位数乘两位数", "口算、笔算、估算；有趣的乘法计算",
                 "掌握两位数乘两位数，理解竖式计算的算理。",
                 "Multiply two-digit numbers by two-digit numbers.",
                 "逻辑", "系统"),
            unit("千米和吨", "认识千米、吨；长度与质量单位的选择和换算",
                 "知道 1 千米=1000 米、1 吨=1000 千克，能解决简单实际问题。",
                 "Use kilometres and tonnes with metric conversions.",
                 "形式", "全球"),
            unit("解决问题的策略", "从问题出发、列表；简单归一、归总问题",
                 "用列表等策略分析数量关系。",
                 "Use tables and working backwards to solve word problems.",
                 "逻辑", "交流"),
            unit("混合运算", "不含括号、含括号的两步运算；算“24 点”",
                 "掌握混合运算顺序，正确计算两步式题。",
                 "Follow order of operations in two-step calculations.",
                 "系统", "逻辑"),
            unit("年、月、日", "平年闰年；大月小月；24 时计时法",
                 "知道年、月、日的关系，会判断平年闰年，能用 24 时计时法表示时刻。",
                 "Use the calendar and 24-hour time.",
                 "时空", "系统"),
            unit("长方形和正方形的面积", "面积含义；面积单位；长方形、正方形面积计算",
                 "理解面积，会选用单位并计算长方形、正方形面积。",
                 "Measure and calculate rectangular area.",
                 "形式", "逻辑"),
            unit("分数的初步认识（二）", "分数的再认识；简单的分数加减（同分母）",
                 "加深对分数意义的理解，能计算简单同分母分数加减。",
                 "Add and subtract simple like fractions.",
                 "关系", "形式"),
            unit("小数的初步认识", "一位小数的含义；小数的读写与简单大小比较",
                 "结合元角分、米和厘米认识一位小数。",
                 "Read and compare one-decimal-place numbers.",
                 "形式", "关联"),
            unit("数据的收集和整理（二）", "以一当二、当五的统计图；上学时间",
                 "根据数据特点选择统计图，能读懂简单统计结果。",
                 "Read scaled pictographs and simple bar graphs.",
                 "交流", "系统"),
        ],
    },
    4: {
        "Semester 1": [
            unit("升和毫升", "认识升、毫升；容量的测量与估计",
                 "知道 1 升=1000 毫升，能选择合适单位描述容量。",
                 "Measure capacity in litres and millilitres.",
                 "形式", "关联"),
            unit("两位数除以两位数", "口算、笔算、试商；商是一位数或两位数",
                 "掌握两位数除以两位数，能灵活试商。",
                 "Divide by two-digit numbers with estimation of the quotient.",
                 "逻辑", "系统"),
            unit("观察物体", "从三个方向观察立体图形；根据视图还原",
                 "能辨认从前面、右面、上面看到的形状。",
                 "Match 3D objects with front, side and top views.",
                 "视角", "时空"),
            unit("统计表和条形统计图（一）", "单式统计表；1 格表示 1 个或多个单位的条形统计图",
                 "能制作和读懂简单统计表、条形统计图。",
                 "Make and interpret simple tables and bar graphs.",
                 "交流", "系统"),
            unit("解决问题的策略", "画图、列表；相遇等行程问题的初步思考",
                 "用画图策略理解题意、寻找数量关系。",
                 "Use diagrams to analyse two-step problems.",
                 "逻辑", "创造力"),
            unit("可能性", "一定、可能、不可能；游戏公平",
                 "定性描述随机现象的可能性。",
                 "Describe chance with certain, possible and impossible.",
                 "逻辑", "视角"),
            unit("整数四则混合运算", "三步混合运算；括号的作用",
                 "正确进行整数四则混合运算，理解运算顺序。",
                 "Compute multi-step integer expressions with brackets.",
                 "系统", "逻辑"),
            unit("垂线与平行线", "垂直、平行；画垂线、平行线；点到直线的距离",
                 "理解垂直与平行，会用工具画图。",
                 "Identify and draw perpendicular and parallel lines.",
                 "形式", "时空"),
        ],
        "Semester 2": [
            unit("平移、旋转和轴对称", "在方格纸上平移、旋转；轴对称图形的补全",
                 "能在方格纸上按要求画出图形运动后的图形。",
                 "Draw translations, rotations and reflections on a grid.",
                 "变化", "形式"),
            unit("认识多位数", "万级、亿级；多位数的读写、改写与近似数",
                 "理解计数单位，能读写亿以内（含）的多位数。",
                 "Read and write large numbers using periods of four digits.",
                 "系统", "形式"),
            unit("三位数乘两位数", "笔算、估算；因数中间或末尾有 0",
                 "掌握三位数乘两位数，能解决简单实际问题。",
                 "Multiply three-digit by two-digit numbers.",
                 "逻辑", "系统"),
            unit("用计算器计算", "计算器的使用；探索规律；一亿有多大",
                 "会用计算器计算并探索简单规律，感受大数。",
                 "Use a calculator and explore number patterns.",
                 "系统", "发展"),
            unit("解决问题的策略", "从条件出发、从问题出发的综合运用；假设",
                 "灵活选择策略解决三步左右的实际问题。",
                 "Choose strategies for multi-step problems.",
                 "逻辑", "创造力"),
            unit("运算律", "加法交换律、结合律；乘法交换律、结合律、分配律；简便计算",
                 "理解并应用运算律进行简便运算。",
                 "Apply commutative, associative and distributive laws.",
                 "逻辑", "系统"),
            unit("三角形、平行四边形和梯形", "分类与特征；三角形内角和；多边形的内角和",
                 "掌握常见平面图形特征，知道三角形内角和是 180°。",
                 "Classify triangles, parallelograms and trapezoids.",
                 "形式", "逻辑"),
            unit("确定位置", "用“第几行第几列”确定位置；数字与信息",
                 "在方格图中用数对的雏形描述位置。",
                 "Locate objects using row-and-column language.",
                 "时空", "交流"),
        ],
    },
    5: {
        "Semester 1": [
            unit("负数的初步认识", "生活中的负数；0 以上、0 以下；简单大小比较",
                 "结合温度、海拔等认识负数，能比较简单正负数的大小。",
                 "Interpret negative numbers in familiar contexts.",
                 "形式", "变化"),
            unit("多边形的面积", "平行四边形、三角形、梯形面积；组合图形",
                 "理解转化思想，掌握面积公式并能解决实际问题。",
                 "Derive and use area formulae via transformation.",
                 "形式", "逻辑"),
            unit("小数的意义和性质", "小数的意义与计数单位；性质；移动小数点引起的大小变化",
                 "理解小数与分数、计数单位的关系，会按要求改写。",
                 "Understand decimal place value and properties.",
                 "系统", "形式"),
            unit("小数加法和减法", "小数加减的意义与计算；估算；简单应用",
                 "小数点对齐，正确计算小数加减法。",
                 "Add and subtract decimals with place-value alignment.",
                 "逻辑", "系统"),
            unit("小数乘法和除法", "小数乘整数、乘小数；除数是整数和小数的除法；近似数",
                 "掌握小数乘除法，会用四舍五入求积、商的近似数。",
                 "Multiply and divide decimals, including rounding.",
                 "逻辑", "关系"),
            unit("统计表和条形统计图（二）", "复式统计表；复式条形统计图",
                 "能读懂并制作复式统计图表，进行简单分析。",
                 "Read and make double bar graphs and tables.",
                 "交流", "系统"),
        ],
        "Semester 2": [
            unit("方程", "用字母表示数；等式的性质；解简单方程；列方程解决问题",
                 "理解方程的含义，会解简单方程并解决实际问题。",
                 "Write and solve simple equations.",
                 "逻辑", "关系"),
            unit("确定位置", "用数对确定位置；根据方向和距离确定位置",
                 "在方格图中用数对表示位置，用方向和距离描述路线。",
                 "Use coordinate pairs and direction-distance language.",
                 "时空", "交流"),
            unit("公因数和公倍数", "公因数、最大公因数；公倍数、最小公倍数；互质",
                 "会求两个数的最大公因数和最小公倍数，能解决简单实际问题。",
                 "Find HCF and LCM of two numbers.",
                 "系统", "逻辑"),
            unit("分数的基本性质", "分数与除法；基本性质；约分、通分；分数与小数互化",
                 "理解分数基本性质，会约分、通分。",
                 "Simplify fractions and find common denominators.",
                 "关系", "形式"),
            unit("分数加法和减法", "同分母、异分母分数加减；整数、小数、分数混合",
                 "掌握分数加减法，能解决简单实际问题。",
                 "Add and subtract fractions with like and unlike denominators.",
                 "逻辑", "系统"),
            unit("折线统计图", "单式、复式折线统计图；数量增减变化",
                 "能读懂并绘制折线统计图，分析数据变化。",
                 "Read and draw line graphs of change over time.",
                 "变化", "交流"),
            unit("解决问题的策略", "转化；复杂的归一、归总与和差倍问题",
                 "用转化策略把新问题变成已学问题。",
                 "Solve problems by transforming them into known types.",
                 "逻辑", "创造力"),
            unit("圆", "圆的认识；圆周率；周长与面积；环形",
                 "理解圆的特征，会计算圆的周长和面积。",
                 "Know circle features and compute circumference and area.",
                 "形式", "审美"),
        ],
    },
    6: {
        "Semester 1": [
            unit("长方体和正方体", "认识与展开图；表面积、体积与容积；表面涂色的正方体",
                 "掌握长方体、正方体表面积和体积计算，理解容积。",
                 "Find surface area and volume of cuboids and cubes.",
                 "形式", "时空"),
            unit("分数乘法", "分数乘整数、乘分数；求一个数的几分之几是多少",
                 "理解分数乘法的意义，正确计算并解决实际问题。",
                 "Multiply fractions and find a fractional part of a quantity.",
                 "逻辑", "关系"),
            unit("分数除法", "分数除以整数、一个数除以分数；倒数；比的认识",
                 "理解分数除法的意义，会求倒数，认识比。",
                 "Divide fractions and introduce ratios.",
                 "关系", "逻辑"),
            unit("解决问题的策略", "假设；替换；画图与列表的综合",
                 "用假设等策略解决较复杂的实际问题。",
                 "Use substitution and assuming strategies.",
                 "逻辑", "创造力"),
            unit("分数四则混合运算", "分数四则混合运算顺序；简便计算",
                 "正确进行分数四则混合运算。",
                 "Compute multi-step expressions with fractions.",
                 "系统", "逻辑"),
            unit("百分数", "百分数的意义；百分数与分数、小数互化；利率、折扣等应用",
                 "理解百分数，能解决简单百分数实际问题。",
                 "Use percentages in discount, interest and statistics.",
                 "关联", "社区"),
        ],
        "Semester 2": [
            unit("扇形统计图", "扇形统计图的特点；读图与简单制作",
                 "能读懂扇形统计图，体会部分与总体的关系。",
                 "Read pie charts as parts of a whole.",
                 "交流", "形式"),
            unit("圆柱和圆锥", "圆柱的认识与侧面积、表面积、体积；圆锥的体积",
                 "掌握圆柱、圆锥体积（及圆柱表面积）的计算。",
                 "Find volume of cylinders and cones.",
                 "形式", "逻辑"),
            unit("解决问题的策略", "转化；鸡兔同笼等典型问题",
                 "灵活运用转化、假设等策略。",
                 "Apply transformation strategies to classic problems.",
                 "逻辑", "创造力"),
            unit("比例", "比例的意义和基本性质；解比例；面积的变化；比例尺",
                 "理解比例，会解比例，认识比例尺。",
                 "Write and solve proportions; use map scales.",
                 "关系", "系统"),
            unit("确定位置", "用方向和距离确定位置；在方格图上描述路线",
                 "用方向角和距离在平面图上确定物体位置。",
                 "Locate positions with direction and distance.",
                 "时空", "交流"),
            unit("正比例和反比例", "正比例、反比例的意义；图像的初步认识；大树有多高",
                 "判断成正比例或反比例的量，能看简单图像。",
                 "Identify direct and inverse proportion.",
                 "变化", "关联"),
        ],
    },
}

HKB: dict[int, dict[str, list[dict]]] = {
    7: {
        "Semester 1": [
            unit("有理数", "正数和负数；数轴、相反数、绝对值；有理数的大小与四则、乘方；近似数",
                 "理解有理数及其运算，能正确进行有理数混合运算。",
                 "Operate with rational numbers on the number line.",
                 "形式", "系统"),
            unit("整式加减", "用字母表示数；代数式；单项式与多项式；合并同类项、去括号",
                 "会列代数式，掌握整式加减。",
                 "Simplify algebraic expressions by combining like terms.",
                 "形式", "逻辑"),
            unit("一次方程与方程组", "一元一次方程；二元一次方程组；三元一次方程组简介；综合与实践：一次方程组与 CT 技术",
                 "会解一元一次方程和二元一次方程组，能列方程（组）解决实际问题。",
                 "Solve linear equations and systems and apply them.",
                 "逻辑", "关联"),
            unit("直线与角", "几何图形；线段、射线、直线；角的度量、比较与余角补角；尺规作图",
                 "掌握几何基本元素，会比较角并作线段与角。",
                 "Work with lines, segments and angles, including constructions.",
                 "形式", "时空"),
            unit("数据的收集与整理", "数据收集与整理；统计图；从图表获取信息；综合与实践：珍惜水资源",
                 "经历统计过程，能选择合适统计图并读取信息。",
                 "Collect, display and interpret statistical data.",
                 "交流", "系统"),
        ],
        "Semester 2": [
            unit("实数", "平方根、立方根；实数的概念、分类、数轴与运算",
                 "理解无理数与实数，会求简单方根并进行实数运算。",
                 "Understand real numbers including square and cube roots.",
                 "形式", "系统"),
            unit("一元一次不等式与不等式组", "不等式及其性质；解一元一次不等式（组）；综合与实践：排队问题",
                 "会解一元一次不等式（组），能在数轴上表示解集。",
                 "Solve linear inequalities and represent solution sets.",
                 "逻辑", "关系"),
            unit("整式乘法与因式分解", "幂的运算；整式乘法；平方差与完全平方公式；因式分解；综合与实践：纳米材料",
                 "掌握整式乘法与常用因式分解方法。",
                 "Multiply polynomials and factorise using common methods.",
                 "形式", "逻辑"),
            unit("分式", "分式及其基本性质；分式四则运算；分式方程",
                 "会约分、通分与分式运算，能解可化为一元一次方程的分式方程。",
                 "Operate with algebraic fractions and solve fractional equations.",
                 "关系", "系统"),
            unit("相交线、平行线与平移", "相交线与对顶角、垂线；平行线的判定与性质；平移",
                 "掌握平行线判定与性质，认识平移变换。",
                 "Use parallel-line facts and translations.",
                 "形式", "变化"),
        ],
    },
    8: {
        "Semester 1": [
            unit("平面直角坐标系", "平面内点的坐标；图形在坐标系中的平移",
                 "会由点求坐标、由坐标描点，能描述平移前后点的坐标变化。",
                 "Plot points and describe translations in the coordinate plane.",
                 "时空", "形式"),
            unit("一次函数", "函数概念；正比例函数与一次函数；一次函数与方程、不等式；综合与实践：一次函数模型",
                 "理解一次函数的图像和性质，能用一次函数模型解决简单问题。",
                 "Model linear relationships with functions and graphs.",
                 "变化", "关联"),
            unit("三角形中的边角关系、命题与证明", "三角形边角关系与重要线段；命题、定理与证明；内角和定理",
                 "掌握三角形基本事实，学习简单推理证明。",
                 "Prove simple triangle facts from definitions and theorems.",
                 "逻辑", "形式"),
            unit("全等三角形", "全等三角形的性质；SAS、ASA、SSS、AAS、HL",
                 "能选择适当判定方法证明三角形全等，并推出对应边、角相等。",
                 "Prove triangle congruence and deduce corresponding parts.",
                 "逻辑", "关系"),
            unit("轴对称图形与等腰三角形", "轴对称；线段垂直平分线；等腰三角形；角平分线",
                 "掌握轴对称性质及等腰三角形、垂直平分线、角平分线定理。",
                 "Use reflection symmetry and isosceles-triangle theorems.",
                 "审美", "形式"),
        ],
        "Semester 2": [
            unit("二次根式", "二次根式的概念；二次根式的乘除与加减",
                 "会化简二次根式，正确进行二次根式运算。",
                 "Simplify and operate with quadratic surds.",
                 "形式", "系统"),
            unit("一元二次方程", "一元二次方程；直接开平方、配方、公式、因式分解；根的判别式；根与系数关系；应用",
                 "会解一元二次方程，能根据判别式判断根的情况并解决实际问题。",
                 "Solve quadratic equations and interpret the discriminant.",
                 "逻辑", "关系"),
            unit("勾股定理", "勾股定理及其逆定理；简单应用",
                 "能用勾股定理及其逆定理解决直角三角形问题。",
                 "Apply the Pythagorean theorem and its converse.",
                 "逻辑", "时空"),
            unit("四边形", "多边形内角和；平行四边形；矩形、菱形、正方形；综合与实践：多边形的镶嵌",
                 "掌握平行四边形及特殊平行四边形的性质与判定。",
                 "Prove properties of parallelograms and special quadrilaterals.",
                 "形式", "系统"),
            unit("数据的初步分析", "频数分布；平均数、中位数、众数；方差；综合与实践：体重指数",
                 "会计算并选择合适的统计量描述数据的集中趋势与离散程度。",
                 "Summarise data with averages and measures of spread.",
                 "逻辑", "交流"),
        ],
    },
    9: {
        "Semester 1": [
            unit("二次函数", "二次函数的图像和性质；二次函数与一元二次方程；二次函数的应用；综合与实践：获取最大利润",
                 "掌握抛物线的开口、顶点、对称轴，能求最值并解决简单实际问题。",
                 "Graph quadratics and use them for maximum/minimum problems.",
                 "变化", "逻辑"),
            unit("反比例函数", "反比例函数的图像和性质；简单应用",
                 "理解反比例函数，能根据图像和解析式解决简单问题。",
                 "Graph and apply inverse proportion functions.",
                 "关系", "关联"),
            unit("相似形", "比例线段与黄金分割；相似三角形的判定与性质；位似；综合与实践：测量与误差",
                 "能判定三角形相似并利用性质进行测量与计算。",
                 "Prove triangle similarity and use scale factors.",
                 "形式", "关系"),
            unit("解直角三角形", "锐角三角函数；特殊角；解直角三角形及其在仰角、方位、坡度中的应用",
                 "会用正弦、余弦、正切解直角三角形。",
                 "Solve right triangles using trigonometric ratios.",
                 "时空", "逻辑"),
        ],
        "Semester 2": [
            unit("圆的性质", "旋转；圆的定义；垂径定理；圆心角、弧、弦；圆周角",
                 "掌握圆的基本定理，能进行简单推理与计算。",
                 "Use circle theorems including inscribed and central angles.",
                 "形式", "逻辑"),
            unit("直线与圆、正多边形", "直线与圆的位置关系；切线；三角形内切圆；正多边形与圆；弧长和扇形面积",
                 "会判断直线与圆的位置关系，计算弧长与扇形面积。",
                 "Analyse tangents, inscribed circles and sector area.",
                 "关系", "形式"),
            unit("投影与视图", "投影；三视图",
                 "能由立体图形画出三视图，由三视图想象立体形状。",
                 "Relate 3D objects to orthographic views.",
                 "视角", "时空"),
            unit("概率初步", "随机事件；等可能情形下的概率；用频率估计概率；综合与实践：概率在遗传学中的应用",
                 "会用列表、树状图计算简单概率，理解频率与概率的关系。",
                 "Compute simple probabilities and estimate from frequency.",
                 "逻辑", "系统"),
        ],
    },
}


def build_units(grade: int, semester: str, raw: list[dict], prefix: str) -> list[dict]:
    weeks = split_weeks(len(raw))
    wp = weekly_periods(grade)
    stamp = f"{prefix}-g{grade}-{'s1' if semester.endswith('1') else 's2'}"
    out = []
    for i, item in enumerate(raw):
        w = weeks[i]
        out.append({
            "id": f"unit-{stamp}-{i}",
            "title": item["title"],
            "focus": item["focus"],
            "keyConcepts": item["keyConcepts"],
            "week": w,
            "periods": wp * week_span(w),
            "order": i,
        })
    return out


def request_json(method: str, url: str, token: str | None = None, payload: dict | None = None) -> dict:
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:800]
        raise RuntimeError(f"{method} {url} -> {e.code}: {detail}") from e


def login() -> str:
    body = request_json("POST", f"{API}/auth/login", payload={"username": ADMIN_USER, "password": ADMIN_PASS})
    token = body.get("token")
    if not token:
        raise RuntimeError(f"login failed: {body}")
    return token


def find_course_id(token: str, name: str) -> str:
    raw = request_json("GET", f"{API}/courses", token=token)
    courses = raw if isinstance(raw, list) else raw.get("courses", [])
    hits = [c for c in courses if isinstance(c, dict) and str(c.get("name", "")).strip() == name]
    if not hits:
        names = [str(c.get("name", "")) for c in courses if isinstance(c, dict)]
        raise RuntimeError(f"course not found: {name!r}; available: {names}")
    return str(hits[0]["id"])


def save_course(token: str, course_id: str, catalog: dict[int, dict[str, list[dict]]], prefix: str, grades: range) -> tuple[int, list]:
    ok, fail = 0, []
    for grade in grades:
        for semester in ("Semester 1", "Semester 2"):
            raw = catalog[grade][semester]
            units = build_units(grade, semester, raw, prefix)
            payload = {"courseId": course_id, "grade": grade, "semester": semester, "units": units}
            label = f"{prefix} G{grade} {semester}"
            try:
                saved = request_json("POST", f"{API}/semester", token=token, payload=payload)
                n = len(saved.get("units") or [])
                titles = " / ".join(u["title"] for u in units)
                print(f"OK  {label}: {n} units | {titles}")
                ok += 1
            except Exception as e:
                print(f"FAIL {label}: {e}", file=sys.stderr)
                fail.append((label, str(e)))
    return ok, fail


def verify(token: str, course_id: str, catalog: dict[int, dict[str, list[dict]]], grades: range) -> bool:
    good = True
    for grade in grades:
        for semester in ("Semester 1", "Semester 2"):
            url = f"{API}/semester/{course_id}/{grade}/{urllib.parse.quote(semester)}"
            data = request_json("GET", url, token=token)
            n = len(data.get("units") or [])
            expect = len(catalog[grade][semester])
            if n != expect:
                print(f"VERIFY FAIL {course_id} G{grade} {semester}: got {n}, expect {expect}", file=sys.stderr)
                good = False
    return good


def main() -> int:
    token = login()
    sjb_id = find_course_id(token, COURSE_SJB_NAME)
    hkb_id = find_course_id(token, COURSE_HKB_NAME)
    print(f"Using {COURSE_SJB_NAME} id={sjb_id}")
    print(f"Using {COURSE_HKB_NAME} id={hkb_id}")
    print(f"API {API}")
    ok1, fail1 = save_course(token, sjb_id, SJB, "sjb", range(1, 7))
    ok2, fail2 = save_course(token, hkb_id, HKB, "hkb", range(7, 10))
    fail = fail1 + fail2
    total = ok1 + ok2
    print(f"\nDone: {total}/18 semesters saved, {len(fail)} failed.")
    if fail:
        return 1
    v1 = verify(token, sjb_id, SJB, range(1, 7))
    v2 = verify(token, hkb_id, HKB, range(7, 10))
    if not (v1 and v2):
        return 1
    print("Verify: all 18 math semesters match catalog unit counts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
