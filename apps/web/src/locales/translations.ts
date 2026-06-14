import { Language } from '../types/language';

export type TranslationKey = 
  // Main interface
  | 'app.title'
  | 'view.overview'
  | 'view.unit'
  | 'view.concept'
  | 'view.showPeriods'
  | 'view.hidePeriods'
  | 'view.roadmapNavAria'
  // Course management
  | 'course.add'
  | 'course.edit'
  | 'course.delete'
  | 'course.settings'
  | 'course.subjectCategory'
  | 'course.gradeRange'
  | 'course.textbookVersion'
  | 'course.weeklyPeriods'
  | 'course.color'
  | 'course.name'
  // Semester
  | 'semester.overview'
  | 'semester.addUnit'
  | 'semester.clearAll'
  | 'semester.close'
  | 'semester.noUnits'
  | 'semester.noUnitsHint'
  | 'semester.clearConfirm'
  | 'semester.moveUp'
  | 'semester.moveDown'
  | 'semester.weekLabel'
  | 'semester.periodsLabel'
  | 'semester.periodsUnit'
  // Unit
  | 'unit.title'
  | 'unit.focus'
  | 'unit.keyConcepts'
  | 'unit.week'
  | 'unit.periods'
  | 'unit.add'
  | 'unit.edit'
  | 'unit.delete'
  // Common
  | 'common.save'
  | 'common.cancel'
  | 'common.confirm'
  | 'common.delete'
  | 'common.edit'
  | 'common.close'
  | 'common.import'
  | 'common.export'
  | 'common.aiImport'
  | 'common.excelImport'
  // Settings
  | 'settings.title'
  | 'settings.description'
  | 'settings.courseManagement'
  | 'settings.columnOrder'
  | 'settings.columnOrderHint'
  | 'settings.saveColumnOrder'
  | 'settings.columnOrderSaved'
  | 'settings.columnOrderSaveFailed'
  | 'settings.unsavedColumnOrderConfirm'
  | 'settings.exportCourseData'
  | 'settings.importCourseData'
  | 'settings.exportCourseDataTitle'
  | 'settings.importCourseDataTitle'
  // AI
  | 'ai.generate'
  | 'ai.generating'
  | 'ai.searching'
  | 'ai.parsing'
  | 'ai.complete'
  // AI Assistant (chat)
  | 'ai.assistant.title'
  | 'ai.assistant.sensingContext'
  | 'ai.assistant.modelLabel'
  | 'ai.assistant.greeting'
  | 'ai.assistant.greetingDesc'
  | 'ai.assistant.promptIdlZh'
  | 'ai.assistant.promptIdlEn'
  | 'ai.assistant.reasoning'
  | 'ai.assistant.reasoningSeconds'
  | 'ai.assistant.placeholder'
  | 'ai.assistant.clearChat'
  | 'ai.assistant.clearChatTitle'
  | 'ai.assistant.clearConfirm'
  | 'ai.assistant.poweredBy'
  | 'ai.assistant.regenerateIdl'
  | 'ai.assistant.errorMessage'
  // AI Panel (unified SUIS AI)
  | 'ai.panel.newChat'
  | 'ai.panel.chats'
  | 'ai.panel.contextNone'
  | 'ai.panel.contextCurriculum'
  | 'ai.panel.contextStudent'
  | 'ai.panel.contextAssistant'
  | 'ai.panel.back'
  | 'ai.panel.upload'
  | 'ai.panel.mode'
  | 'ai.panel.modeThink'
  | 'ai.panel.modeWeb'
  | 'ai.panel.greeting'
  | 'ai.panel.greetingEn'
  | 'ai.panel.deleteChatConfirm'
  | 'ai.panel.deleteChatConfirmDesc'
  // Dialog descriptions
  | 'dialog.addCourse.description'
  | 'dialog.editCourse.description'
  | 'dialog.settings.description'
  | 'dialog.semester.description'
  // Placeholders and hints
  | 'hint.subjectCategory'
  | 'hint.gradeRange'
  | 'hint.textbookVersion'
  | 'hint.weeklyPeriods'
  | 'hint.courseNameAuto'
  | 'hint.textbookInfoFormat'
  // Semester selection
  | 'semester.select'
  | 'semester.selectPlaceholder'
  // Concept view
  | 'concept.legend'
  | 'concept.cross3Plus'
  | 'concept.cross2'
  | 'concept.single'
  | 'concept.connectedUnits'
  | 'concept.units'
  | 'concept.crossSubjects'
  | 'concept.disciplines'
  | 'concept.noData'
  | 'concept.noDataHint'
  | 'concept.firstSemester'
  | 'concept.secondSemester'
  | 'concept.weeks'
  | 'concept.periods'
  // Concept settings
  | 'concept.settings'
  | 'concept.settings.title'
  | 'concept.settings.description'
  | 'concept.settings.add'
  | 'concept.settings.edit'
  | 'concept.settings.delete'
  | 'concept.settings.default'
  | 'concept.settings.defaultConfirm'
  | 'concept.settings.empty'
  | 'concept.settings.emptyHint';

export const translations: Record<Language, Record<TranslationKey, string>> = {
  zh: {
    // Main interface
    'app.title': '课程河流',
    'view.overview': '整体视图',
    'view.unit': '单元视图',
    'view.concept': '概念视图',
    'view.showPeriods': '显示课时',
    'view.hidePeriods': '隐藏课时',
    'view.roadmapNavAria': '课程视图切换',
    // Course management
    'course.add': '添加课程',
    'course.edit': '编辑课程',
    'course.delete': '删除课程',
    'course.settings': '设置',
    'course.subjectCategory': '课程类别',
    'course.gradeRange': '开设年级与周课时',
    'course.textbookVersion': '教材版本',
    'course.weeklyPeriods': '周课时数',
    'course.color': '选择颜色',
    'course.name': '课程名称',
    // Semester
    'semester.overview': '学期总览',
    'semester.addUnit': '添加单元',
    'semester.clearAll': '清除单元',
    'semester.close': '关闭',
    'semester.noUnits': '暂无单元',
    'semester.noUnitsHint': '点击"添加单元"开始创建',
    'semester.clearConfirm': '确定要清除所有单元吗？此操作不可恢复。',
    'semester.moveUp': '上移',
    'semester.moveDown': '下移',
    'semester.weekLabel': '周次',
    'semester.periodsLabel': '课时',
    'semester.periodsUnit': '节',
    // Unit
    'unit.title': '主题',
    'unit.focus': '核心内容',
    'unit.keyConcepts': '关键概念',
    'unit.week': '周次',
    'unit.periods': '课时',
    'unit.add': '添加单元',
    'unit.edit': '编辑',
    'unit.delete': '删除',
    // Common
    'common.save': '保存',
    'common.cancel': '取消',
    'common.confirm': '确认',
    'common.delete': '删除',
    'common.edit': '编辑',
    'common.close': '关闭',
    'common.import': '导入',
    'common.export': '导出',
    'common.aiImport': 'AI导入',
    'common.excelImport': 'Excel导入',
    // Settings
    'settings.title': '设置',
    'settings.description': '管理课程设置',
    'settings.courseManagement': '课程设置',
    'settings.columnOrder': '整体视图课程列顺序',
    'settings.columnOrderHint': '左侧箭头调整整体视图中的学科列顺序；改完后请点击「保存顺序」同步（与岗位安排表头一致）。',
    'settings.saveColumnOrder': '保存顺序',
    'settings.columnOrderSaved': '顺序已保存。',
    'settings.columnOrderSaveFailed': '保存顺序失败，请检查网络后重试。',
    'settings.unsavedColumnOrderConfirm': '列顺序已修改但未保存，确定要关闭吗？',
    'settings.exportCourseData': '导出课程数据',
    'settings.importCourseData': '导入课程数据',
    'settings.exportCourseDataTitle': '导出为 JSON：含 courses、semesterData、keyConcepts、categoryOrder、courseDomains 等全校共享课程数据',
    'settings.importCourseDataTitle': '选择由本系统导出的 .json 文件；导入将覆盖当前全校课程与相关数据',
    // AI
    'ai.generate': '开始生成',
    'ai.generating': '生成中...',
    'ai.searching': '正在搜索教材信息...',
    'ai.parsing': '解析与校验...',
    'ai.complete': '生成完成！',
    // AI Assistant (chat)
    'ai.assistant.title': '课程河流 AI 助手',
    'ai.assistant.sensingContext': '正在感知当前上下文',
    'ai.assistant.modelLabel': 'AI模型',
    'ai.assistant.greeting': '你好！我是你的课程助手',
    'ai.assistant.greetingDesc': '我可以帮你设计单元主题、建议跨学科联系，或者基于当前视图的数据为你提供优化方案。',
    'ai.assistant.promptIdlZh': '设计跨学科学习体验（中文）',
    'ai.assistant.promptIdlEn': 'Design Interdisciplinary Learning (English)',
    'ai.assistant.reasoning': '思考过程',
    'ai.assistant.reasoningSeconds': '思考了 {n} 秒',
    'ai.assistant.placeholder': '问问 AI 助手...',
    'ai.assistant.clearChat': '清除对话',
    'ai.assistant.clearChatTitle': '清空记录',
    'ai.assistant.clearConfirm': '确定要清空聊天记录吗？',
    'ai.assistant.poweredBy': 'Powered by SiliconFlow',
    'ai.assistant.regenerateIdl': '再次生成跨学科设计：',
    'ai.assistant.errorMessage': '抱歉，服务暂时出现了一点问题，请稍后再试。',
    // AI Panel
    'ai.panel.newChat': '新聊天',
    'ai.panel.chats': '对话',
    'ai.panel.contextNone': '无',
    'ai.panel.contextCurriculum': '课程河流',
    'ai.panel.contextStudent': '学生画像',
    'ai.panel.contextAssistant': '课堂助手',
    'ai.panel.back': '返回',
    'ai.panel.upload': '上传',
    'ai.panel.mode': '模式',
    'ai.panel.modeThink': '思考',
    'ai.panel.modeWeb': '联网',
    'ai.panel.greeting': '你好，{name}，从哪里开始？',
    'ai.panel.greetingEn': 'Hi {name}, where should we start?',
    'ai.panel.deleteChatConfirm': '删除对话',
    'ai.panel.deleteChatConfirmDesc': '确定要删除这条对话记录吗？删除后无法恢复。',
    // Dialog descriptions
    'dialog.addCourse.description': '课程名称将自动生成为"课程类别-教材版本"',
    'dialog.editCourse.description': '修改课程信息',
    'dialog.settings.description': '管理课程设置',
    'dialog.semester.description': '查看和管理该学期的单元',
    // Placeholders and hints
    'hint.subjectCategory': '例如：数学、语文、英语',
    'hint.gradeRange': '单击切换单个年级；按住拖拽可一次选中连续年级（与原先拖拽一致）。可非连续开设（如仅 G1、G3、G5），在下方为每个年级填写周课时数。',
    'hint.textbookVersion': '例如：人教版、IGCSE0580、北师大版',
    'hint.weeklyPeriods': '按年级分别设置周课时（可为 0.5 的倍数，如 0.5、1.5 表示单双周隔周上课）；AI 生成单元与整体视图中的课时均以此为依据。',
    'hint.courseNameAuto': '课程名称将自动生成为"课程类别-教材版本"',
    'hint.textbookInfoFormat': '格式：课程类别-教材版本-学期。已自动填充，可根据需要修改',
    // Semester selection
    'semester.select': '选择学期',
    'semester.selectPlaceholder': '-- 请选择学期 --',
    // Concept view
    'concept.legend': '相关单元数量',
    'concept.cross3Plus': '8+ 立体紫',
    'concept.cross2': '4-7 立体蓝',
    'concept.single': '0-3 立体灰',
    'concept.connectedUnits': '连接',
    'concept.units': '个单元',
    'concept.crossSubjects': '跨越',
    'concept.disciplines': '个学科',
    'concept.noData': '暂无概念数据',
    'concept.noDataHint': '请在单元视图中为单元添加核心概念',
    'concept.firstSemester': '上学期',
    'concept.secondSemester': '下学期',
    'concept.weeks': '周',
    'concept.periods': '节课',
    // Concept settings
    'concept.settings': '概念设置',
    'concept.settings.title': '关键概念设置',
    'concept.settings.description': '管理可用于单元的核心概念列表',
    'concept.settings.add': '添加概念',
    'concept.settings.edit': '编辑',
    'concept.settings.delete': '删除',
    'concept.settings.default': '恢复默认',
    'concept.settings.defaultConfirm': '确定要恢复为默认的16个概念吗？这将覆盖当前的自定义概念列表。',
    'concept.settings.empty': '暂无概念',
    'concept.settings.emptyHint': '点击"添加概念"按钮添加新的关键概念',
  },
  en: {
    // Main interface
    'app.title': 'Curriculum Roadmap',
    'view.overview': 'Overview',
    'view.unit': 'Unit View',
    'view.concept': 'Concept View',
    'view.showPeriods': 'Show periods',
    'view.hidePeriods': 'Hide periods',
    'view.roadmapNavAria': 'Curriculum view switcher',
    // Course management
    'course.add': 'Add Course',
    'course.edit': 'Edit Course',
    'course.delete': 'Delete Course',
    'course.settings': 'Settings',
    'course.subjectCategory': 'Subject Category',
    'course.gradeRange': 'Grades & weekly periods',
    'course.textbookVersion': 'Textbook Version',
    'course.weeklyPeriods': 'Weekly Periods',
    'course.color': 'Color',
    'course.name': 'Course Name',
    // Semester
    'semester.overview': 'Semester Overview',
    'semester.addUnit': 'Add Unit',
    'semester.clearAll': 'Clear All Units',
    'semester.close': 'Close',
    'semester.noUnits': 'No units',
    'semester.noUnitsHint': 'Click "Add Unit" to start creating',
    'semester.clearConfirm': 'Are you sure you want to clear all units? This action cannot be undone.',
    'semester.moveUp': 'Move Up',
    'semester.moveDown': 'Move Down',
    'semester.weekLabel': 'Week',
    'semester.periodsLabel': 'Periods',
    'semester.periodsUnit': 'periods',
    // Unit
    'unit.title': 'Title',
    'unit.focus': 'Focus',
    'unit.keyConcepts': 'Key Concepts',
    'unit.week': 'Week',
    'unit.periods': 'Periods',
    'unit.add': 'Add Unit',
    'unit.edit': 'Edit',
    'unit.delete': 'Delete',
    // Common
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.close': 'Close',
    'common.import': 'Import',
    'common.export': 'Export',
    'common.aiImport': 'AI Import',
    'common.excelImport': 'Excel Import',
    // Settings
    'settings.title': 'Settings',
    'settings.description': 'Manage course settings',
    'settings.courseManagement': 'Course Management',
    'settings.columnOrder': 'Overview column order',
    'settings.columnOrderHint': 'Use the arrows on the left to set overview column order. Click “Save order” to sync (same as staffing roster headers).',
    'settings.saveColumnOrder': 'Save order',
    'settings.columnOrderSaved': 'Order saved.',
    'settings.columnOrderSaveFailed': 'Failed to save order. Check your connection and try again.',
    'settings.unsavedColumnOrderConfirm': 'Column order was changed but not saved. Close anyway?',
    'settings.exportCourseData': 'Export course data',
    'settings.importCourseData': 'Import course data',
    'settings.exportCourseDataTitle': 'Exports JSON with school-wide courses, semesterData, keyConcepts, categoryOrder, courseDomains',
    'settings.importCourseDataTitle': 'Choose a .json file exported by this app; import overwrites school-wide course data',
    // AI
    'ai.generate': 'Generate',
    'ai.generating': 'Generating...',
    'ai.searching': 'Searching textbook information...',
    'ai.parsing': 'Parsing and validating...',
    'ai.complete': 'Generation complete!',
    // AI Assistant (chat)
    'ai.assistant.title': 'Curriculum Roadmap AI Assistant',
    'ai.assistant.sensingContext': 'Sensing current context',
    'ai.assistant.modelLabel': 'AI Model',
    'ai.assistant.greeting': 'Hello! I\'m your curriculum assistant',
    'ai.assistant.greetingDesc': 'I can help you design unit themes, suggest interdisciplinary links, or offer suggestions based on your current view.',
    'ai.assistant.promptIdlZh': 'Design interdisciplinary learning (Chinese)',
    'ai.assistant.promptIdlEn': 'Design Interdisciplinary Learning (English)',
    'ai.assistant.reasoning': 'Reasoning',
    'ai.assistant.reasoningSeconds': 'Thought for {n}s',
    'ai.assistant.placeholder': 'Ask the AI assistant...',
    'ai.assistant.clearChat': 'Clear chat',
    'ai.assistant.clearChatTitle': 'Clear history',
    'ai.assistant.clearConfirm': 'Are you sure you want to clear the chat?',
    'ai.assistant.poweredBy': 'Powered by SiliconFlow',
    'ai.assistant.regenerateIdl': 'Regenerate interdisciplinary design:',
    'ai.assistant.errorMessage': 'Something went wrong. Please try again later.',
    // AI Panel
    'ai.panel.newChat': 'New chat',
    'ai.panel.chats': 'Chats',
    'ai.panel.contextNone': 'None',
    'ai.panel.contextCurriculum': 'Curriculum Roadmap',
    'ai.panel.contextStudent': 'Student Portrait',
    'ai.panel.contextAssistant': 'Class Assistant',
    'ai.panel.back': 'Back',
    'ai.panel.upload': 'Upload',
    'ai.panel.mode': 'Mode',
    'ai.panel.modeThink': 'Think',
    'ai.panel.modeWeb': 'Web',
    'ai.panel.greeting': 'Hi {name}, where should we start?',
    'ai.panel.greetingEn': 'Hi {name}, where should we start?',
    'ai.panel.deleteChatConfirm': 'Delete chat',
    'ai.panel.deleteChatConfirmDesc': 'Are you sure you want to delete this chat? This cannot be undone.',
    // Dialog descriptions
    'dialog.addCourse.description': 'Course name will be auto-generated as "Subject Category-Textbook Version"',
    'dialog.editCourse.description': 'Edit course information',
    'dialog.settings.description': 'Manage course settings',
    'dialog.semester.description': 'View and manage units for this semester',
    // Placeholders and hints
    'hint.subjectCategory': 'e.g., Math, Chinese, English',
    'hint.gradeRange': 'Click to toggle a grade. Click and drag across cells to select a contiguous range (same as before). Non-contiguous grades are OK; enter weekly periods for each selected grade below.',
    'hint.textbookVersion': 'e.g., People\'s Education Edition, IGCSE0580',
    'hint.weeklyPeriods': 'Weekly periods per grade in 0.5 increments (e.g. 0.5, 1.5 for alternate-week schedules); used for AI unit generation and the roadmap.',
    'hint.courseNameAuto': 'Course name will be auto-generated as "Subject Category-Textbook Version"',
    'hint.textbookInfoFormat': 'Format: Subject Category-Textbook Version-Semester. Auto-filled, can be modified',
    // Semester selection
    'semester.select': 'Select Semester',
    'semester.selectPlaceholder': '-- Please select semester --',
    // Concept view
    'concept.legend': 'Related Units',
    'concept.cross3Plus': '8+ (3D Purple)',
    'concept.cross2': '4-7 (3D Blue)',
    'concept.single': '0-3 (3D Gray)',
    'concept.connectedUnits': 'Connected',
    'concept.units': 'units',
    'concept.crossSubjects': 'Across',
    'concept.disciplines': 'disciplines',
    'concept.noData': 'No concept data',
    'concept.noDataHint': 'Please add key concepts to units in Unit View',
    'concept.firstSemester': 'First Semester',
    'concept.secondSemester': 'Second Semester',
    'concept.weeks': 'weeks',
    'concept.periods': 'periods',
    // Concept settings
    'concept.settings': 'Concept Settings',
    'concept.settings.title': 'Key Concepts Settings',
    'concept.settings.description': 'Manage the list of core concepts available for units',
    'concept.settings.add': 'Add Concept',
    'concept.settings.edit': 'Edit',
    'concept.settings.delete': 'Delete',
    'concept.settings.default': 'Restore Default',
    'concept.settings.defaultConfirm': 'Are you sure you want to restore the default 16 concepts? This will overwrite your current custom concept list.',
    'concept.settings.empty': 'No concepts',
    'concept.settings.emptyHint': 'Click "Add Concept" to add new key concepts',
  },
};
