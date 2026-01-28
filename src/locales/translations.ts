import { Language } from '../types/language';

export type TranslationKey = 
  // Main interface
  | 'app.title'
  | 'view.overview'
  | 'view.unit'
  | 'view.concept'
  | 'view.showPeriods'
  | 'view.hidePeriods'
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
  // AI
  | 'ai.generate'
  | 'ai.generating'
  | 'ai.searching'
  | 'ai.parsing'
  | 'ai.complete'
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
    // Course management
    'course.add': '添加课程',
    'course.edit': '编辑课程',
    'course.delete': '删除课程',
    'course.settings': '设置',
    'course.subjectCategory': '课程类别',
    'course.gradeRange': '年级跨度',
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
    // AI
    'ai.generate': '开始生成',
    'ai.generating': '生成中...',
    'ai.searching': '正在搜索教材信息...',
    'ai.parsing': '解析与校验...',
    'ai.complete': '生成完成！',
    // Dialog descriptions
    'dialog.addCourse.description': '课程名称将自动生成为"课程类别-教材版本"',
    'dialog.editCourse.description': '修改课程信息',
    'dialog.settings.description': '管理课程设置',
    'dialog.semester.description': '查看和管理该学期的单元',
    // Placeholders and hints
    'hint.subjectCategory': '例如：数学、语文、英语',
    'hint.gradeRange': '拖拽选择该课程适用的年级范围，如"1-6"表示适用于G1到G6',
    'hint.textbookVersion': '例如：人教版、IGCSE0580、北师大版',
    'hint.weeklyPeriods': '该课程每周的课时数，用于AI生成单元时自动计算单元总课时',
    'hint.courseNameAuto': '课程名称将自动生成为"课程类别-教材版本"',
    'hint.textbookInfoFormat': '格式：课程类别-教材版本-学期。已自动填充，可根据需要修改',
    // Semester selection
    'semester.select': '选择学期',
    'semester.selectPlaceholder': '-- 请选择学期 --',
    // Concept view
    'concept.legend': '图例',
    'concept.cross3Plus': '跨3+学科（立体紫）',
    'concept.cross2': '跨2学科（立体蓝）',
    'concept.single': '单学科（立体灰）',
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
    // Course management
    'course.add': 'Add Course',
    'course.edit': 'Edit Course',
    'course.delete': 'Delete Course',
    'course.settings': 'Settings',
    'course.subjectCategory': 'Subject Category',
    'course.gradeRange': 'Grade Range',
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
    // AI
    'ai.generate': 'Generate',
    'ai.generating': 'Generating...',
    'ai.searching': 'Searching textbook information...',
    'ai.parsing': 'Parsing and validating...',
    'ai.complete': 'Generation complete!',
    // Dialog descriptions
    'dialog.addCourse.description': 'Course name will be auto-generated as "Subject Category-Textbook Version"',
    'dialog.editCourse.description': 'Edit course information',
    'dialog.settings.description': 'Manage course settings',
    'dialog.semester.description': 'View and manage units for this semester',
    // Placeholders and hints
    'hint.subjectCategory': 'e.g., Math, Chinese, English',
    'hint.gradeRange': 'Drag to select grade range, e.g., "1-6" means G1 to G6',
    'hint.textbookVersion': 'e.g., People\'s Education Edition, IGCSE0580',
    'hint.weeklyPeriods': 'Weekly class hours, used for AI unit generation',
    'hint.courseNameAuto': 'Course name will be auto-generated as "Subject Category-Textbook Version"',
    'hint.textbookInfoFormat': 'Format: Subject Category-Textbook Version-Semester. Auto-filled, can be modified',
    // Semester selection
    'semester.select': 'Select Semester',
    'semester.selectPlaceholder': '-- Please select semester --',
    // Concept view
    'concept.legend': 'Legend',
    'concept.cross3Plus': '3+ Disciplines (3D Purple)',
    'concept.cross2': '2 Disciplines (3D Blue)',
    'concept.single': 'Single Discipline (3D Gray)',
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
