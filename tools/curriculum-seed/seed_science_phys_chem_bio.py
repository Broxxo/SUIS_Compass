#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
逐学期写入理科课程（不走 curriculum/import 整包覆盖）：

- 科学 G1–G6 → 「科学-教科版」（2024 新教材；G1–2 为新增低年级册）
- 物理 G8–G9 → 「物理-物理」（沪科 2024 全一册，按学期拆分）
- 化学 G9 → 「化学-化学」（人教 2024）
- 生物 G7–G8 → 「生物-生物」（人教 2024 新课标）

周次：16 个教学周（跳过第 9、18 周）。课时沿用课程已设周课时。
G9 对应学校年级 id g10。标题与学习重点中英对照。
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

SCIENCE_NAME = os.environ.get("SUIS_SCIENCE_COURSE", "科学-教科版")
PHYSICS_NAME = os.environ.get("SUIS_PHYSICS_COURSE", "物理-物理")
CHEM_NAME = os.environ.get("SUIS_CHEM_COURSE", "化学-化学")
BIO_NAME = os.environ.get("SUIS_BIO_COURSE", "生物-生物")

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
    focus = f"主要内容：{content} Main content: {extra} 学习重点：{task}"
    return {
        "title": title,
        "focus": focus,
        "keyConcepts": [KC[c] for c in concepts],
    }


SCIENCE: dict[int, dict[str, list[dict]]] = {
    1: {
        "Semester 1": [
            unit("第一单元 周围的植物 / Unit 1 Plants Around Us",
                 "我们知道的植物；观察植物；植物长在哪里；给植物画张“像”；植物的变化；校园里的植物。",
                 "观察身边植物的外形、生长处和变化，并在校园里认一认。Learning focus: observe plants nearby and notice how they grow and change.",
                 "Familiar plants, where they grow, drawing, change and a campus plant walk.",
                 "形式", "变化"),
            unit("第二单元 我们自己 / Unit 2 Ourselves",
                 "我们的身体；发现生长；游戏中的观察；气味告诉我们；通过感官发现；观察与比较；做个“时间胶囊”。",
                 "认识身体外形与生长，用多种感官观察，并制作时间胶囊。Learning focus: the body, growing up, using the senses, and a time capsule.",
                 "Body parts, growth, senses, comparing observations and a time capsule.",
                 "身份", "发展"),
        ],
        "Semester 2": [
            unit("第一单元 身边的物体 / Unit 1 Objects Around Us",
                 "观察物体的特征；给物体分类；比较轻重；认识形状；观察水；哪个流动得快；它们去哪里了；认识空气。",
                 "用感官比较物体的特征、轻重、形状，观察水和空气。Learning focus: describe, sort and compare objects, including water and air.",
                 "Features, sorting, weight, shape, water, flow and air.",
                 "形式", "逻辑"),
            unit("第二单元 常见的动物 / Unit 2 Familiar Animals",
                 "我们知道的动物；校园里的动物；观察一种动物；给动物建个“家”；观察鱼；给动物分类。",
                 "观察常见动物的外形、家和食物，尝试简单分类。Learning focus: observe familiar animals, their homes and food, and sort them.",
                 "Campus animals, close observation, animal homes, fish and grouping.",
                 "关系", "形式"),
        ],
    },
    2: {
        "Semester 1": [
            unit("第一单元 造房子 / Unit 1 Building a House",
                 "动物的家；我们的家；家里的物品；设计小房子；建造小房子；“小房子”展示会。",
                 "比较动物的家和人的家，设计并搭建小房子。Learning focus: compare animal and human homes, then design and build a model house.",
                 "Animal homes, our homes, household objects and a model-house exhibition.",
                 "形式", "创造力"),
            unit("第二单元 地球家园 / Unit 2 Our Earth Home",
                 "地球家园有什么；我们的校园；我们周围的空气；不同的天气；不同的季节；太阳与白天；夜晚的月亮。",
                 "认识地球家园中的空气、天气、季节、太阳和月亮。Learning focus: air, weather, seasons, the Sun and the Moon on Earth.",
                 "Campus, air, weather, seasons, daytime Sun and nighttime Moon.",
                 "时空", "变化"),
        ],
        "Semester 2": [
            unit("第一单元 探秘恐龙 / Unit 1 Exploring Dinosaurs",
                 "恐龙的故事；挖掘恐龙“化石”；测量与拼接“化石”；复原恐龙；制作恐龙模型；我们的恐龙公园。",
                 "用模拟化石探究恐龙，并制作模型和“恐龙公园”。Learning focus: dig, measure and reconstruct “fossils”, then make a dinosaur model.",
                 "Dinosaur stories, fossils, reconstruction, models and a dino park.",
                 "视角", "创造力"),
            unit("第二单元 玩磁铁 / Unit 2 Playing with Magnets",
                 "磁铁能吸引什么；比较力量的大小；让小车动起来；隔物吸铁；设计钓鱼玩具；我们来钓鱼。",
                 "探究磁铁能吸什么、力量大小和隔物吸铁，并做钓鱼玩具。Learning focus: what magnets attract, how strong they are, and a fishing toy.",
                 "Attraction, magnetic strength, moving a car, through-object pull and fishing.",
                 "系统", "创造力"),
        ],
    },
    3: {
        "Semester 1": [
            unit("第一单元 天气 / Unit 1 Weather",
                 "我们关心天气；认识气温计；测量气温与降水量；观测风与云；天气预报；天气的影响。",
                 "学会观测气温、降水、风和云，读懂简单天气预报。Learning focus: observe weather and read a simple forecast.",
                 "Thermometers, rainfall, wind, clouds and forecasts.",
                 "变化", "时空"),
            unit("第二单元 水 / Unit 2 Water",
                 "水到哪里去了；水珠从哪里来；水沸腾了；水结冰了；冰融化了；溶解与分离。",
                 "观察水的三态变化，探究溶解与分离。Learning focus: water’s states, dissolving and separating.",
                 "Evaporation, boiling, freezing, melting, dissolving.",
                 "变化", "形式"),
            unit("第三单元 物体的运动 / Unit 3 Motion of Objects",
                 "运动和位置；直线与曲线运动；相同距离/时间比快慢；运动和能量；设计和测试“过山车”。",
                 "用位置描述运动，比较快慢，把运动与能量联系起来。Learning focus: describe motion and compare speed.",
                 "Position, types of motion, speed and energy; roller-coaster design.",
                 "变化", "系统"),
        ],
        "Semester 2": [
            unit("第一单元 辨别方向 / Unit 1 Finding Direction",
                 "根据太阳和自然物辨别方向；磁极与方向；制作小磁针和指南针；用指南针寻宝。",
                 "用太阳、自然物和磁铁辨别方向。Learning focus: find direction with the Sun, nature and magnets.",
                 "Sun, landmarks, magnetic poles and homemade compasses.",
                 "时空", "系统"),
            unit("第二单元 动物的一生 / Unit 2 Animal Life Cycles",
                 "不同种类的动物；动物的繁殖；养蚕观察；昆虫的一生；动物的生命周期。",
                 "通过养蚕认识昆虫变态和动物生命周期。Learning focus: observe silkworms and animal life cycles.",
                 "Animal groups, reproduction, silkworms and insect life cycles.",
                 "发展", "变化"),
            unit("第三单元 只有一个地球 / Unit 3 Only One Earth",
                 "地球是我们的家园；水的星球；地球的卫星；环形山；太阳；影的变化；地球的“兄弟姐妹”。",
                 "认识地球、月球与太阳系中的行星。Learning focus: Earth, Moon, Sun and neighbouring planets.",
                 "Earth as a water planet, Moon, Sun, shadows and the solar family.",
                 "时空", "全球"),
        ],
    },
    4: {
        "Semester 1": [
            unit("第一单元 空气 / Unit 1 Air",
                 "感受空气；空气占据空间和质量；空气流动有力量；风的成因；热气球；自制打气筒。",
                 "用实验证明空气有空间、质量和力量。Learning focus: prove that air takes space, has mass and can move things.",
                 "Air occupies space, has mass, flowing air and wind.",
                 "形式", "系统"),
            unit("第二单元 呼吸与消化 / Unit 2 Breathing and Digestion",
                 "呼吸器官；呼吸的变化与肺活量；口腔、胃和小肠里的消化；食物在身体里的旅行；呵护器官。",
                 "认识呼吸与消化器官，学会保护身体。Learning focus: how we breathe and digest, and how to care for organs.",
                 "Lungs, digestion pathway and organ care.",
                 "系统", "发展"),
            unit("第三单元 声音 / Unit 3 Sound",
                 "声音是怎样产生的；强弱与高低；设计并改进乐器；声音的传播；保护听力。",
                 "探究声音的产生、高低强弱与传播。Learning focus: how sound is made, changed and heard safely.",
                 "Vibration, pitch, volume, musical instruments and hearing.",
                 "形式", "交流"),
        ],
        "Semester 2": [
            unit("第一单元 植物的生长变化 / Unit 1 How Plants Grow",
                 "种子里孕育着新生命；种植观察根、茎、叶、花、果；种子的传播；植物的一生。",
                 "种植并记录一株植物从种子到开花结果。Learning focus: follow a plant from seed to fruit.",
                 "Seeds, roots, stems, leaves, flowers, fruit and seed dispersal.",
                 "发展", "变化"),
            unit("第二单元 土壤 / Unit 2 Soil",
                 "探寻土壤；腐殖质、砂和黏土；不一样的土壤；土壤与植物生长；土壤危机与保护；家乡的土壤。",
                 "认识土壤组成，理解土壤与植物、环境保护的关系。Learning focus: what soil is made of and why it must be protected.",
                 "Humus, sand, clay, plant growth and soil conservation.",
                 "系统", "全球"),
            unit("第三单元 电路 / Unit 3 Electric Circuits",
                 "电和我们的生活；点亮小灯泡；简易电路与故障；导体和绝缘体；设计并模拟安装照明电路。",
                 "组装简单电路，区分导体与绝缘体。Learning focus: build a simple lighting circuit safely.",
                 "Bulbs, simple circuits, conductors, insulators and lighting design.",
                 "系统", "创造力"),
        ],
    },
    5: {
        "Semester 1": [
            unit("第一单元 微小世界 / Unit 1 The Tiny World",
                 "研究放大镜；怎样放得更大；简易/光学显微镜；观察细胞与水中微小生物；微生物与人类。",
                 "用放大镜和显微镜观察细胞与微生物。Learning focus: use lenses and microscopes to see cells and microbes.",
                 "Magnifiers, microscopes, cells, pond life and microbes.",
                 "形式", "视角"),
            unit("第二单元 工具与技术 / Unit 2 Tools and Technology",
                 "各种各样的工具；独轮车省力；斜面与滑轮；给小车安装方向盘；社会发展与工具和技术。",
                 "体会简单机械如何省力，并改进小车。Learning focus: simple machines that reduce effort.",
                 "Wheelbarrows, inclined planes, pulleys and steering.",
                 "系统", "发展"),
            unit("第三单元 运动和力 / Unit 3 Motion and Force",
                 "拆解小车模型；重力/弹力驱动；测量力；比较摩擦力；制作并评价“月球小车”。",
                 "认识力与运动，比较摩擦并设计小车。Learning focus: gravity, elastic force, friction and a lunar rover model.",
                 "Forces, friction and a student-built rover.",
                 "系统", "创造力"),
            unit("第四单元 地球表面的变化 / Unit 4 Changes on Earth’s Surface",
                 "地球的表面；火山与地震；岩石的类别与变化；水与风对地表的作用。",
                 "理解内力和外力如何改变地表。Learning focus: volcanoes, earthquakes, rocks, water and wind shape land.",
                 "Volcanoes, earthquakes, rocks, water and wind.",
                 "变化", "时空"),
        ],
        "Semester 2": [
            unit("第一单元 生物与环境 / Unit 1 Living Things and Their Environment",
                 "种子发芽实验；阳光下的植物；蚯蚓的选择；环境改变；食物关系；制作生态瓶。",
                 "用对照实验认识生物对环境的需求和食物关系。Learning focus: needs of living things and food relationships in an eco-bottle.",
                 "Germination, light, earthworms, food links and eco-bottles.",
                 "关系", "系统"),
            unit("第二单元 热 / Unit 2 Heat",
                 "热从哪里来；热与水的变化；温度与热的传递；金属和水中的传热；制作保温杯。",
                 "认识热的来源与传递，比较不同材料传热。Learning focus: heat sources, transfer and insulation.",
                 "Heat, temperature, conduction and a thermos design.",
                 "变化", "系统"),
            unit("第三单元 人与自然 / Unit 3 People and Nature",
                 "地球上的资源；合理利用与循环；垃圾分类；保护环境；应对自然灾害；我们的环保行动。",
                 "认识资源有限，落实分类与环保行动。Learning focus: use resources wisely and take environmental action.",
                 "Resources, recycling, disasters and eco-action.",
                 "全球", "社区"),
            unit("第四单元 船的研究 / Unit 4 Investigating Boats",
                 "不同材料的沉浮；用能浮/坚固的材料造船；增加装载量；船博会；制作和测试小船。",
                 "探究沉浮与船体设计，测试装载量。Learning focus: floating, boat materials and load capacity.",
                 "Buoyancy, materials, load and boat testing.",
                 "形式", "创造力"),
        ],
    },
    6: {
        "Semester 1": [
            unit("第一单元 健康生活 / Unit 1 Healthy Living",
                 "健康成长的信息；食物中的营养与均衡；身体的“总指挥”；睡眠与情绪；制订健康生活计划。",
                 "用证据认识营养、睡眠与情绪，制订个人健康计划。Learning focus: nutrition, rest, emotions and a personal health plan.",
                 "Nutrition, the brain as commander, sleep, emotions and planning.",
                 "发展", "系统"),
            unit("第二单元 光 / Unit 2 Light",
                 "怎样能看到物体；光的传播与穿透；光的反射；设计制作潜望镜；制造彩虹。",
                 "探究光的直线传播、反射与色散。Learning focus: how we see, reflection, periscopes and rainbows.",
                 "Seeing, transmission, reflection, periscopes and colour.",
                 "形式", "审美"),
            unit("第三单元 地球的运动 / Unit 3 Earth’s Motion",
                 "地球模型；昼夜交替与自转；哪里先迎来黎明；影长的四季变化；公转与四季。",
                 "用模型解释昼夜和四季。Learning focus: rotation, revolution, day/night and seasons.",
                 "Earth models, day and night, shadow length and seasons.",
                 "时空", "系统"),
            unit("第四单元 计量时间 / Unit 4 Measuring Time",
                 "时间在流逝；用水计量时间并做水钟；机械摆钟与钟摆；时间与变化。",
                 "设计和改进计时装置，理解时间测量。Learning focus: water clocks, pendulums and measuring time.",
                 "Water clocks, pendulums and time as change.",
                 "系统", "变化"),
        ],
        "Semester 2": [
            unit("第一单元 生物的多样性 / Unit 1 Biodiversity",
                 "校园生物大搜索与分布图；形形色色的植物和动物；相貌各异的我们；多样的古生物；保护生物多样性。",
                 "调查校园生物，认识多样性并思考保护。Learning focus: survey campus life and protect biodiversity.",
                 "Campus survey, plants, animals, humans, fossils and conservation.",
                 "关系", "全球"),
            unit("第二单元 能量 / Unit 2 Energy",
                 "各种形式的能；电能和磁能；电动机；让小船行驶起来；电能从哪里来；物质变化中的能量；能源与可持续发展。",
                 "认识能量形式转化，关注能源与可持续。Learning focus: forms of energy, motors and sustainable energy.",
                 "Energy forms, electricity, magnetism, motors and sustainability.",
                 "系统", "全球"),
            unit("第三单元 制作天文望远镜 / Unit 3 Making a Telescope",
                 "怎样看得更远、更准确；设计制作支架与旋转结构；组装并用天文望远镜观测。",
                 "设计和制作简易天文望远镜并观测。Learning focus: design, build and use a simple telescope.",
                 "Magnification, mounts, rotation and sky observing.",
                 "创造力", "时空"),
            unit("第四单元 探索宇宙 / Unit 4 Exploring the Universe",
                 "探索宇宙的历程；空间站；月球探索；太阳系与八颗行星；星座与浩瀚星空。",
                 "了解人类探索宇宙的历程和太阳系结构。Learning focus: space exploration, the solar system and constellations.",
                 "Space stations, the Moon, planets, constellations and the wider cosmos.",
                 "时空", "视角"),
        ],
    },
}

PHYSICS: dict[int, dict[str, list[dict]]] = {
    8: {
        "Semester 1": [
            unit("绪论·第一章 运动的世界 / Intro & Ch.1 A World of Motion",
                 "打开物理世界的大门；动与静；快与慢；测量长度与时间；测量物体运动的速度。",
                 "用参照物判断运动，测量长度、时间和速度。Learning focus: rest vs motion, measuring length, time and speed.",
                 "Frames of reference, length, time and speed.",
                 "变化", "系统"),
            unit("第二章 声的世界 / Ch.2 A World of Sound",
                 "声音的产生与传播；声音的特性；超声波与次声波；噪声控制与健康生活。",
                 "理解声音的产生、传播和特性，关注噪声与健康。Learning focus: how sound is made, travels and can harm hearing.",
                 "Vibration, pitch, ultrasound, infrasound and noise.",
                 "形式", "交流"),
            unit("第三章 光的世界 / Ch.3 A World of Light",
                 "光的反射定律；平面镜成像；光的折射；光的色散。",
                 "完成反射与平面镜成像探究，认识折射与色散。Learning focus: reflection, plane-mirror images, refraction and colour.",
                 "Reflection, plane mirrors, refraction and dispersion.",
                 "形式", "逻辑"),
            unit("第四章 神奇的透镜 / Ch.4 Amazing Lenses",
                 "凸透镜与凹透镜；凸透镜成像的规律；神奇的“眼睛”。",
                 "探究凸透镜成像，联系眼睛与视力矫正。Learning focus: converging/diverging lenses, images and the eye.",
                 "Convex/concave lenses, image rules and vision.",
                 "系统", "形式"),
            unit("第五章 质量与密度 / Ch.5 Mass and Density",
                 "质量；测量物体的质量；密度；测量固体和液体的密度。",
                 "区分质量与密度，会测固体和液体密度。Learning focus: mass vs density and how to measure both.",
                 "Mass, density and measurement of solids and liquids.",
                 "形式", "系统"),
            unit("第六章 熟悉而陌生的力 / Ch.6 Familiar yet Strange Forces",
                 "力及其描述；弹簧测力计；重力；滑动摩擦力的影响因素。",
                 "会画力的示意图，测量力并探究滑动摩擦。Learning focus: describing forces, gravity and sliding friction.",
                 "Force diagrams, spring meters, gravity and friction.",
                 "系统", "逻辑"),
        ],
        "Semester 2": [
            unit("第七章 力与运动 / Ch.7 Force and Motion",
                 "牛顿第一定律；力的合成；二力平衡。",
                 "用牛顿第一定律和二力平衡解释运动状态。Learning focus: inertia, combining forces and two-force balance.",
                 "Newton’s first law, resultant force and equilibrium.",
                 "系统", "逻辑"),
            unit("第八章 压强 / Ch.8 Pressure",
                 "压力的作用效果；液体压强；大气压；流体压强与流速。",
                 "理解固体、液体、气体压强及流速关系。Learning focus: pressure in solids, liquids, air and flowing fluids.",
                 "Pressure, liquid pressure, atmosphere and flow speed.",
                 "系统", "变化"),
            unit("第九章 浮力 / Ch.9 Buoyancy",
                 "认识浮力；浮力大小的影响因素；阿基米德原理；物体的浮与沉。",
                 "用阿基米德原理判断浮沉。Learning focus: what buoyancy depends on and why objects float or sink.",
                 "Buoyancy, Archimedes’ principle, floating and sinking.",
                 "系统", "逻辑"),
            unit("第十章 功与机械能 / Ch.10 Work and Mechanical Energy",
                 "机械功；功率；动能和势能；机械能转化及其应用。",
                 "计算功和功率，认识动能、势能及其转化。Learning focus: work, power and mechanical energy changes.",
                 "Work, power, kinetic/potential energy and conversion.",
                 "变化", "系统"),
            unit("第十一章 简单机械 / Ch.11 Simple Machines",
                 "杠杆的平衡条件；滑轮及其应用；机械效率。",
                 "探究杠杆平衡，认识滑轮和机械效率。Learning focus: levers, pulleys and mechanical efficiency.",
                 "Levers, pulleys and efficiency.",
                 "系统", "创造力"),
            unit("第十二章 小粒子与大宇宙 / Ch.12 Tiny Particles and the Vast Universe",
                 "走进微观；看不见的运动；探索宇宙；弘扬科学家精神。",
                 "从分子热运动连到宇宙探索与科学家精神。Learning focus: the particle model, unseen motion and exploring the cosmos.",
                 "Particles, thermal motion, the universe and scientific spirit.",
                 "视角", "时空"),
        ],
    },
    9: {
        "Semester 1": [
            unit("第十二章 温度与物态变化 / Ch.12 Temperature and Changes of State",
                 "温度与温度计；熔化与凝固；汽化与液化；升华与凝华；全球变暖与水资源危机。",
                 "用温度描述物态变化，关注气候与水资源。Learning focus: temperature, changes of state, warming and water.",
                 "Thermometers, melting, boiling, sublimation and climate.",
                 "变化", "全球"),
            unit("第十三章 内能与热机 / Ch.13 Internal Energy and Heat Engines",
                 "物体的内能；物质的比热容；内燃机；热机效率与环境保护。",
                 "理解内能、比热容和热机，关注效率与环保。Learning focus: internal energy, specific heat and heat engines.",
                 "Internal energy, specific heat capacity, engines and the environment.",
                 "系统", "全球"),
            unit("第十四章 了解电路 / Ch.14 Understanding Circuits",
                 "电是什么；让电灯发光；串并联电路；串并联电路的电流；测量电压。",
                 "连接串并联电路，测量电流和电压。Learning focus: series/parallel circuits, current and voltage.",
                 "Charge, lamps, series, parallel, current and voltage.",
                 "系统", "形式"),
            unit("第十五章 探究电路 / Ch.15 Investigating Circuits",
                 "电阻和变阻器；欧姆定律；伏安法测电阻；电阻的串并联；家庭用电。",
                 "用欧姆定律和伏安法测电阻，认识家庭电路。Learning focus: resistance, Ohm’s law and household electricity.",
                 "Resistors, Ohm’s law, series/parallel resistance and home circuits.",
                 "逻辑", "系统"),
        ],
        "Semester 2": [
            unit("第十六章 电流做功与电功率 / Ch.16 Electrical Work and Power",
                 "电流做功；电流做功的快慢；测量电功率；电流的热效应。",
                 "计算电功和电功率，理解电流热效应。Learning focus: electrical work, power and heating.",
                 "Electrical work, power and the heating effect of current.",
                 "系统", "变化"),
            unit("第十七章 从指南针到磁悬浮 / Ch.17 From Compass to Maglev",
                 "磁是什么；电流的磁场；电动机为什么会转动。",
                 "认识磁场、电流磁效应和电动机原理。Learning focus: magnets, the magnetic field of a current and motors.",
                 "Magnetism, electromagnetism and electric motors.",
                 "系统", "发展"),
            unit("第十八章 电从哪里来 / Ch.18 Where Electricity Comes From",
                 "电能的产生；怎样产生感应电流；电能的输送。",
                 "理解电磁感应和电能输送。Learning focus: generating electricity, induction and transmission.",
                 "Generation, electromagnetic induction and the grid.",
                 "系统", "全球"),
            unit("第十九章 走进信息时代 / Ch.19 Entering the Information Age",
                 "感受信息；让信息飞起来；踏上信息高速公路。",
                 "了解信息的获取、传递与现代通信。Learning focus: how information is sensed, sent and networked.",
                 "Information, signals and modern communication.",
                 "交流", "发展"),
            unit("第二十章 能量、材料与社会 / Ch.20 Energy, Materials and Society",
                 "能量的转化与守恒；能源的开发与利用；材料的开发与利用。",
                 "用能量守恒看待能源与材料问题。Learning focus: energy conservation, energy resources and materials.",
                 "Energy conversion, resources and materials in society.",
                 "全球", "系统"),
        ],
    },
}

CHEMISTRY: dict[int, dict[str, list[dict]]] = {
    9: {
        "Semester 1": [
            unit("绪言·第一单元 走进化学世界 / Intro & Unit 1 Entering Chemistry",
                 "化学使世界变得更加绚丽多彩；物质的变化和性质；化学实验与科学探究。",
                 "区分物理变化与化学变化，学会基本实验与探究。Learning focus: physical vs chemical change and lab inquiry.",
                 "What chemistry is, properties, changes and laboratory skills.",
                 "变化", "系统"),
            unit("第二单元 空气和氧气 / Unit 2 Air and Oxygen",
                 "我们周围的空气；氧气；制取氧气；实验室制取与性质；微型空气质量检测。",
                 "认识空气组成，掌握氧气制取与性质。Learning focus: air, oxygen preparation and properties.",
                 "Air, oxygen, laboratory preparation and air quality.",
                 "形式", "全球"),
            unit("第三单元 物质构成的奥秘 / Unit 3 The Mystery of Matter",
                 "分子和原子；原子结构；元素；制作模型展示科学家探索历程。",
                 "用分子、原子和元素解释物质构成。Learning focus: molecules, atoms, atomic structure and elements.",
                 "Molecules, atoms, structure of the atom and elements.",
                 "形式", "系统"),
            unit("第四单元 自然界的水 / Unit 4 Water in Nature",
                 "水资源及其利用；水的组成；物质组成的表示；水质检测及自制净水器。",
                 "认识水的组成与化学式，关注水资源。Learning focus: composition of water, chemical formulae and water resources.",
                 "Water resources, composition of water and chemical formulae.",
                 "形式", "全球"),
            unit("第五单元 化学反应的定量关系 / Unit 5 Quantitative Relations in Reactions",
                 "质量守恒定律；化学方程式；设计和制作简易供氧器。",
                 "用质量守恒定律书写并配平化学方程式。Learning focus: conservation of mass and chemical equations.",
                 "Law of conservation of mass and chemical equations.",
                 "逻辑", "系统"),
            unit("第六单元 碳和碳的氧化物 / Unit 6 Carbon and Its Oxides",
                 "碳单质的多样性；碳的氧化物；二氧化碳的实验室制取与性质；碳中和。",
                 "认识碳单质、CO/CO₂ 及实验室制取，理解碳中和。Learning focus: carbon allotropes, CO₂ and carbon neutrality.",
                 "Carbon, carbon oxides, CO₂ preparation and carbon neutrality.",
                 "变化", "全球"),
            unit("第七单元 能源的合理利用与开发 / Unit 7 Energy Use and Development",
                 "能源概述；化石能源的合理利用；新能源的开发。",
                 "评价化石能源与新能源的利用。Learning focus: fossil fuels, new energy and using energy wisely.",
                 "Fossil fuels, new energy and responsible use.",
                 "全球", "发展"),
        ],
        "Semester 2": [
            unit("第八单元 金属和金属材料 / Unit 8 Metals and Metal Materials",
                 "金属材料；金属的化学性质；金属资源的利用与保护。",
                 "比较金属性质，认识合金与金属资源保护。Learning focus: properties of metals, alloys and protecting metal resources.",
                 "Metals, alloys, chemical properties and resource protection.",
                 "形式", "全球"),
            unit("第九单元 溶液 / Unit 9 Solutions",
                 "溶液及其应用；溶解度；溶液的质量分数；配制溶液与粗盐提纯。",
                 "理解溶解与溶解度，进行溶质质量分数计算。Learning focus: solutions, solubility and mass fraction.",
                 "Solutions, solubility, concentration and purification.",
                 "系统", "逻辑"),
            unit("第十单元 常见的酸、碱、盐 / Unit 10 Common Acids, Bases and Salts",
                 "溶液的酸碱性；常见的酸和碱；常见的盐；复分解反应。",
                 "用 pH 判断酸碱性，掌握酸碱盐的性质与复分解。Learning focus: pH, acids, bases, salts and double displacement.",
                 "Acidity, common acids/bases/salts and double displacement.",
                 "系统", "变化"),
            unit("第十一单元 化学与社会 / Unit 11 Chemistry and Society",
                 "化学与人体健康；化学与可持续发展。",
                 "联系化学与健康、材料、能源和环境。Learning focus: chemistry for health and sustainable development.",
                 "Health, materials, energy, environment and sustainability.",
                 "全球", "关系"),
        ],
    },
}

BIOLOGY: dict[int, dict[str, list[dict]]] = {
    7: {
        "Semester 1": [
            unit("1.1 认识生物 / 1.1 Knowing Living Things",
                 "观察周边环境中的生物；生物的特征。",
                 "从身边生物归纳生命的基本特征。Learning focus: observe local life and list features of living things.",
                 "Surveying living things and the characteristics of life.",
                 "形式", "关系"),
            unit("1.2 认识细胞 / 1.2 Knowing Cells",
                 "学习使用显微镜；植物细胞；动物细胞；细胞的生活。",
                 "会使用显微镜，比较动植物细胞，理解细胞的生活。Learning focus: microscopes, plant vs animal cells, cell life.",
                 "Microscopes, plant and animal cells, and how cells live.",
                 "形式", "系统"),
            unit("1.3 从细胞到生物体 / 1.3 From Cells to Organisms",
                 "细胞分裂；动物体和植物体的结构层次；单细胞生物。",
                 "理解细胞→组织→器官→系统→个体的层次。Learning focus: cell division and levels of organisation.",
                 "Cell division, tissues, organs, systems and unicellular life.",
                 "系统", "发展"),
            unit("2.1 植物的类群 / 2.1 Groups of Plants",
                 "藻类、苔藓和蕨类植物；种子植物。",
                 "比较孢子植物与种子植物的特征。Learning focus: algae, mosses, ferns and seed plants.",
                 "Algae, mosses, ferns, gymnosperms and angiosperms.",
                 "形式", "关系"),
            unit("2.2 动物的类群 / 2.2 Groups of Animals",
                 "无脊椎动物；脊椎动物（鱼、两栖、爬行、鸟、哺乳）。",
                 "按主要特征识别常见动物类群。Learning focus: invertebrates and the main vertebrate groups.",
                 "Invertebrates, fish, amphibians, reptiles, birds and mammals.",
                 "形式", "关系"),
            unit("2.3–2.4 微生物与分类 / 2.3–2.4 Microbes and Classification",
                 "微生物的分布；细菌、真菌、病毒；尝试分类；从种到界。",
                 "认识微生物并练习生物分类。Learning focus: bacteria, fungi, viruses and how we classify life.",
                 "Microbes, viruses and biological classification.",
                 "系统", "逻辑"),
        ],
        "Semester 2": [
            unit("3.1 绿色开花植物的一生 / 3.1 Life of a Flowering Plant",
                 "种子萌发；植株的生长；开花和结果。",
                 "描述种子植物从萌发到开花结果的过程。Learning focus: germination, growth, flowering and fruiting.",
                 "Germination, growth, pollination, fertilisation, fruits and seeds.",
                 "发展", "变化"),
            unit("3.2 植物体内的物质与能量 / 3.2 Matter and Energy in Plants",
                 "水的利用和散失；光合作用；呼吸作用；植物在自然界中的作用。",
                 "理解蒸腾、光合和呼吸，认识植物维持碳氧平衡的作用。Learning focus: transpiration, photosynthesis, respiration and plants in nature.",
                 "Water transport, photosynthesis, respiration and carbon–oxygen balance.",
                 "系统", "全球"),
            unit("4.1 人的生殖和发育 / 4.1 Human Reproduction and Development",
                 "人的生殖；青春期。",
                 "了解人的生殖过程和青春期身心变化。Learning focus: human reproduction and adolescence.",
                 "Reproduction, development and adolescence.",
                 "发展", "身份"),
            unit("4.2 人体的营养 / 4.2 Human Nutrition",
                 "食物中的营养物质；消化和吸收；合理营养与食品安全。",
                 "认识营养素、消化吸收与合理膳食。Learning focus: nutrients, digestion and food safety.",
                 "Nutrients, the digestive system and a balanced diet.",
                 "系统", "发展"),
            unit("4.3 人体的呼吸 / 4.3 Human Respiration",
                 "呼吸道对空气的处理；发生在肺内的气体交换。",
                 "理解呼吸道功能和肺泡处的气体交换。Learning focus: the respiratory tract and gas exchange in the lungs.",
                 "Airways, lungs and gas exchange.",
                 "系统", "变化"),
            unit("4.4–4.5 运输与排泄 / 4.4–4.5 Transport and Excretion",
                 "血液、血管、心脏；人体内废物的排出。",
                 "认识循环系统与泌尿系统如何运输和排出废物。Learning focus: blood, vessels, the heart and excretion.",
                 "Blood, blood vessels, the heart and waste removal.",
                 "系统", "关系"),
        ],
    },
    8: {
        "Semester 1": [
            unit("4.6 人体生命活动的调节 / 4.6 Regulation of Human Life Activities",
                 "人体对外界环境的感知；神经调节；神经系统支配下的运动；激素调节。",
                 "理解神经调节与激素调节如何协调生命活动。Learning focus: senses, nerves, movement and hormones.",
                 "Senses, the nervous system, movement and hormones.",
                 "系统", "关系"),
            unit("4.7 健康地生活 / 4.7 Living Healthily",
                 "传染病及其预防；免疫与免疫规划；用药与急救；选择健康的生活方式。",
                 "用科学方法预防传染病、安全用药并选择健康生活方式。Learning focus: infectious disease, immunity, medicines and healthy choices.",
                 "Infectious disease, immunity, first aid and lifestyle.",
                 "发展", "社区"),
            unit("5.1 生态系统 / 5.1 Ecosystems",
                 "生物与环境的相互作用；生态系统的结构和功能；生物圈；设计并制作生态瓶。",
                 "用生态系统的组成和功能解释生物与环境。Learning focus: living things and environment, ecosystem structure and the biosphere.",
                 "Organisms and environment, ecosystems, the biosphere and eco-bottles.",
                 "系统", "关系"),
            unit("5.2 生态安全 / 5.2 Ecological Security",
                 "生态安全的内涵；人类活动与生态风险；保护生态安全的行动。",
                 "认识生态安全并提出保护行动。Learning focus: ecological security and what people can do.",
                 "Ecological risks, human impact and protection.",
                 "全球", "社区"),
        ],
        "Semester 2": [
            unit("6.1 生物的生殖 / 6.1 Reproduction",
                 "无性生殖；有性生殖；植物的扦插或嫁接。",
                 "比较无性生殖与有性生殖。Learning focus: asexual vs sexual reproduction, including cuttings and grafting.",
                 "Asexual and sexual reproduction in plants and animals.",
                 "发展", "变化"),
            unit("6.2 生物的遗传与变异 / 6.2 Heredity and Variation",
                 "基因与性状；基因在亲子代间的传递；显性和隐性；人的性别决定；生物的变异。",
                 "用基因解释性状传递、性别决定和变异。Learning focus: genes, inheritance, sex determination and variation.",
                 "Genes, traits, dominance, sex chromosomes and variation.",
                 "系统", "逻辑"),
            unit("6.3 生物的进化 / 6.3 Evolution",
                 "地球上生命的起源；生物进化的历程；生物进化的原因。",
                 "用化石证据和自然选择解释进化。Learning focus: origin of life, the history of life and natural selection.",
                 "Origin of life, evolutionary history and natural selection.",
                 "变化", "时空"),
            unit("6.4 生物多样性及其保护 / 6.4 Biodiversity and Conservation",
                 "进化与生物多样性；人与自然和谐共生。",
                 "理解多样性的内涵、价值和保护途径。Learning focus: why biodiversity matters and how to live with nature.",
                 "Biodiversity, threats and living in harmony with nature.",
                 "全球", "关系"),
        ],
    },
}


def weekly_for(grade: int, weekly: dict) -> float:
    if grade == 9:
        v = weekly.get("g10", weekly.get("g9"))
    else:
        v = weekly.get(f"g{grade}")
    if v is None:
        raise RuntimeError(f"no weekly periods for G{grade} in {weekly}")
    return float(v)


def build_units(grade: int, semester: str, raw: list[dict], prefix: str, weekly: dict) -> list[dict]:
    weeks = split_weeks(len(raw))
    wp = weekly_for(grade, weekly)
    stamp = f"{prefix}-g{grade}-{'s1' if semester.endswith('1') else 's2'}"
    out = []
    for i, item in enumerate(raw):
        w = weeks[i]
        periods = wp * week_span(w)
        if abs(periods - round(periods)) < 1e-9:
            periods = int(round(periods))
        out.append({
            "id": f"unit-{stamp}-{i}",
            "title": item["title"],
            "focus": item["focus"],
            "keyConcepts": item["keyConcepts"],
            "week": w,
            "periods": periods,
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


def list_courses(token: str) -> list[dict]:
    raw = request_json("GET", f"{API}/courses", token=token)
    return raw if isinstance(raw, list) else raw.get("courses", [])


def find_course(courses: list[dict], name: str) -> dict:
    hits = [c for c in courses if isinstance(c, dict) and str(c.get("name", "")).strip() == name]
    if not hits:
        names = [str(c.get("name", "")) for c in courses if isinstance(c, dict)]
        raise RuntimeError(f"course not found: {name!r}; available: {names}")
    return hits[0]


def update_course(token: str, course: dict, *, textbook: str,
                  grades: list[str] | None = None, weekly: dict | None = None) -> dict:
    payload = {
        "name": course["name"],
        "subjectCategory": course.get("subjectCategory"),
        "applicableGrades": grades if grades is not None else (course.get("applicableGrades") or []),
        "weeklyPeriodsByGrade": weekly if weekly is not None else (course.get("weeklyPeriodsByGrade") or {}),
        "textbookVersion": textbook,
        "color": course.get("color"),
        "coTeaching": bool(course.get("coTeaching")),
        "excludeFromStaffing": bool(course.get("excludeFromStaffing")),
    }
    cid = str(course["id"])
    saved = request_json("PUT", f"{API}/courses/{cid}", token=token, payload=payload)
    extra = f" grades={payload['applicableGrades']}" if grades is not None else ""
    print(f"Updated {course['name']} textbook={textbook}{extra} id={cid}")
    merged = dict(course)
    if isinstance(saved, dict):
        merged.update(saved)
    merged["id"] = cid
    merged["applicableGrades"] = (
        (saved or {}).get("applicableGrades")
        or payload["applicableGrades"]
        or []
    )
    merged["weeklyPeriodsByGrade"] = (
        (saved or {}).get("weeklyPeriodsByGrade")
        or payload["weeklyPeriodsByGrade"]
        or {}
    )
    return merged


def save_course(token: str, course: dict, catalog: dict[int, dict[str, list[dict]]],
                prefix: str, grades: list[int]) -> tuple[int, list]:
    course_id = str(course["id"])
    weekly = course.get("weeklyPeriodsByGrade") or {}
    ok, fail = 0, []
    for grade in grades:
        for semester in ("Semester 1", "Semester 2"):
            raw = catalog[grade][semester]
            units = build_units(grade, semester, raw, prefix, weekly)
            payload = {"courseId": course_id, "grade": grade, "semester": semester, "units": units}
            label = f"{prefix} G{grade} {semester}"
            try:
                saved = request_json("POST", f"{API}/semester", token=token, payload=payload)
                n = len(saved.get("units") or [])
                titles = " / ".join(u["title"].split(" / ")[0] for u in units)
                print(f"OK  {label}: {n} units | {titles}")
                ok += 1
            except Exception as e:
                print(f"FAIL {label}: {e}", file=sys.stderr)
                fail.append((label, str(e)))
    return ok, fail


def verify(token: str, course: dict, catalog: dict[int, dict[str, list[dict]]], grades: list[int]) -> bool:
    course_id = str(course["id"])
    good = True
    for grade in grades:
        for semester in ("Semester 1", "Semester 2"):
            url = f"{API}/semester/{course_id}/{grade}/{urllib.parse.quote(semester)}"
            data = request_json("GET", url, token=token)
            n = len(data.get("units") or [])
            expect = len(catalog[grade][semester])
            if n != expect:
                print(f"VERIFY FAIL {course.get('name')} G{grade} {semester}: got {n}, expect {expect}", file=sys.stderr)
                good = False
    return good


def main() -> int:
    token = login()
    courses = list_courses(token)
    science = update_course(
        token, find_course(courses, SCIENCE_NAME),
        textbook="教科版（2024）",
        grades=["g1", "g2", "g3", "g4", "g5", "g6"],
        weekly={"g1": 1, "g2": 1, "g3": 1, "g4": 1, "g5": 1, "g6": 2},
    )
    physics = update_course(token, find_course(courses, PHYSICS_NAME), textbook="沪科版（2024）")
    chem = update_course(token, find_course(courses, CHEM_NAME), textbook="人教版（2024）")
    bio = update_course(token, find_course(courses, BIO_NAME), textbook="人教版（2024）")

    print(f"API {API}")
    print(f"Using {SCIENCE_NAME} id={science.get('id')}")
    print(f"Using {PHYSICS_NAME} id={physics.get('id')}")
    print(f"Using {CHEM_NAME} id={chem.get('id')}")
    print(f"Using {BIO_NAME} id={bio.get('id')}")

    ok1, fail1 = save_course(token, science, SCIENCE, "sci", [1, 2, 3, 4, 5, 6])
    ok2, fail2 = save_course(token, physics, PHYSICS, "phy", [8, 9])
    ok3, fail3 = save_course(token, chem, CHEMISTRY, "chem", [9])
    ok4, fail4 = save_course(token, bio, BIOLOGY, "bio", [7, 8])
    fail = fail1 + fail2 + fail3 + fail4
    total = ok1 + ok2 + ok3 + ok4
    print(f"\nDone: {total}/22 semesters saved, {len(fail)} failed.")
    if fail:
        return 1
    v1 = verify(token, science, SCIENCE, [1, 2, 3, 4, 5, 6])
    v2 = verify(token, physics, PHYSICS, [8, 9])
    v3 = verify(token, chem, CHEMISTRY, [9])
    v4 = verify(token, bio, BIOLOGY, [7, 8])
    if not (v1 and v2 and v3 and v4):
        return 1
    print("Verify: all 22 science/physics/chemistry/biology semesters match catalog unit counts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
