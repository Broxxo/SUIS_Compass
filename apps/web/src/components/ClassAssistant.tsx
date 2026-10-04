import { MenuSelect } from './MenuSelect';
import { useState } from 'react'
import AppTopBar from './AppTopBar'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { useClassAssistantData } from './class-assistant/useClassAssistantData'
import { IndividualModeTab } from './class-assistant/IndividualModeTab'
import { GroupModeTab } from './class-assistant/GroupModeTab'
import { CreateGroupDialog } from './class-assistant/CreateGroupDialog'
import { EditGroupDialog } from './class-assistant/EditGroupDialog'
import { SchemeManagerDialog } from './class-assistant/SchemeManagerDialog'
import { CreateSchemeDialog } from './class-assistant/CreateSchemeDialog'

interface ClassAssistantProps {
  onBackToHub?: () => void
}

export default function ClassAssistant({ onBackToHub }: ClassAssistantProps) {
  const { user } = useAuth()
  const { language } = useLanguage()
  const isZh = language === 'zh'

  const data = useClassAssistantData(user, isZh)
  const {
    selectableClasses,
    selectedClassId,
    setSelectedClassId,
    currentClass,
    studentsInClass,
    individualScores,
    schemes,
    selectedSchemeId,
    setSchemeId,
    groups,
    groupMembers,
    groupScores,
    floatingDeltas,
    deniedStudentId,
    soundOn,
    toggleSound,
    dataVersion,
    handleAddStudentPoint,
    handleAddGroupPoint,
    handleCreateGroup,
    openEditGroupDialog,
    handleSaveEditGroup,
    handleCreateScheme,
    handleDeleteScheme,
  } = data

  const [tab, setTab] = useState<'students' | 'groups'>('students')

  const [newGroupName, setNewGroupName] = useState('')
  const [createGroupOpen, setCreateGroupOpen] = useState(false)
  const [createGroupSelectedIds, setCreateGroupSelectedIds] = useState<string[]>([])

  const [editGroupOpen, setEditGroupOpen] = useState(false)
  const [editGroupId, setEditGroupId] = useState<string | null>(null)
  const [editGroupName, setEditGroupName] = useState('')
  const [editGroupSelectedIds, setEditGroupSelectedIds] = useState<string[]>([])
  const [editGroupSchemeId, setEditGroupSchemeId] = useState<string | null>(null)

  const [createGroupForSchemeId, setCreateGroupForSchemeId] = useState<string | null>(null)
  const [createSchemeOpen, setCreateSchemeOpen] = useState(false)
  const [schemeManagerOpen, setSchemeManagerOpen] = useState(false)
  const [schemeMenuOpen, setSchemeMenuOpen] = useState(false)
  const [newSchemeName, setNewSchemeName] = useState('')

  const openCreateGroup = (schemeIdOverride?: string | null) => {
    setNewGroupName('')
    setCreateGroupSelectedIds([])
    setCreateGroupForSchemeId(schemeIdOverride ?? null)
    setCreateGroupOpen(true)
  }

  const openEditGroup = (
    groupId: string,
    groupsToUse: typeof groups,
    membersToUse: typeof groupMembers,
    schemeIdOverride?: string | null,
  ) => {
    const result = openEditGroupDialog(groupId, groupsToUse, membersToUse, schemeIdOverride)
    if (result) {
      setEditGroupId(result.groupId)
      setEditGroupName(result.name)
      setEditGroupSelectedIds(result.memberIds)
      setEditGroupSchemeId(schemeIdOverride ?? null)
      setEditGroupOpen(true)
    }
  }

  if (!user) return null

  return (
    <div className="min-h-dvh w-full max-w-[100%] overflow-x-auto bg-slate-50 pt-[var(--app-topbar-height)]">
      <AppTopBar
        title={isZh ? '课堂助手' : 'Class Assistant'}
        showBack={!!onBackToHub}
        onBack={onBackToHub}
      />

      <div className="border-b border-slate-200 bg-slate-50">
        <div className="max-w-4xl mx-auto px-4">
          <div className="flex items-center justify-between gap-2 py-1.5">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTab('students')}
                className={`inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                  tab === 'students'
                    ? 'bg-slate-600 text-white shadow-sm'
                    : 'bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                }`}
              >
                {isZh ? '个人模式' : 'Individual mode'}
              </button>
              <button
                type="button"
                onClick={() => setTab('groups')}
                className={`inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                  tab === 'groups'
                    ? 'bg-slate-600 text-white shadow-sm'
                    : 'bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                }`}
              >
                {isZh ? '小组模式' : 'Group mode'}
              </button>
            </div>
            <button
              type="button"
              onClick={toggleSound}
              className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors text-slate-600 hover:bg-slate-100"
              title={
                soundOn
                  ? isZh
                    ? '关闭反馈音'
                    : 'Mute sound'
                  : isZh
                    ? '开启反馈音'
                    : 'Sound on'
              }
            >
              <svg
                className={`w-5 h-5 ${soundOn ? 'text-amber-500' : 'text-slate-300'}`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.617.076L4.235 12H2a1 1 0 01-1-1V9a1 1 0 011-1h2.235l4.148-3.924a1 1 0 011.617-.076zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-4 space-y-4">
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0 text-sm font-semibold text-slate-800">
              {isZh ? '选择班级' : 'Select class'}
            </span>
            <MenuSelect
              value={selectedClassId || ''}
              onChange={(e) => setSelectedClassId(e.target.value || null)}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm sm:max-w-xs"
            >
              <option value="">{isZh ? '请选择' : 'Please select'}</option>
              {selectableClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {`G${c.grade} ${c.name}`}
                </option>
              ))}
            </MenuSelect>
          </div>
        </div>

        {!currentClass && (
          <p className="text-sm text-slate-500">
            {isZh ? '当前没有可用的班级。' : 'No available classes.'}
          </p>
        )}

        {currentClass && (
          <>
            {tab === 'students' && (
              <IndividualModeTab
                studentsInClass={studentsInClass}
                individualScores={individualScores}
                deniedStudentId={deniedStudentId}
                isZh={isZh}
                onAddPoint={handleAddStudentPoint}
              />
            )}

            {tab === 'groups' && (
              <GroupModeTab
                isZh={isZh}
                schemes={schemes}
                selectedSchemeId={selectedSchemeId}
                schemeMenuOpen={schemeMenuOpen}
                onSchemeMenuToggle={() => setSchemeMenuOpen((o) => !o)}
                onSelectScheme={(id) => {
                  setSchemeId(id)
                  setSchemeMenuOpen(false)
                }}
                onCreateSchemeClick={() => {
                  setSchemeMenuOpen(false)
                  setCreateSchemeOpen(true)
                  setNewSchemeName('')
                }}
                onDeleteScheme={handleDeleteScheme}
                onSchemeManagerOpen={() => setSchemeManagerOpen(true)}
                groups={groups}
                groupScores={groupScores}
                floatingDeltas={floatingDeltas}
                onAddGroupPoint={handleAddGroupPoint}
                onCreateGroupClick={() => openCreateGroup()}
              />
            )}
          </>
        )}
      </div>

      <CreateGroupDialog
        open={createGroupOpen}
        onOpenChange={setCreateGroupOpen}
        newGroupName={newGroupName}
        onNewGroupNameChange={setNewGroupName}
        createGroupSelectedIds={createGroupSelectedIds}
        onCreateGroupSelectedIdsChange={setCreateGroupSelectedIds}
        studentsInClass={studentsInClass}
        isZh={isZh}
        onSubmit={() => {
          handleCreateGroup(
            newGroupName,
            createGroupSelectedIds,
            () => {
              setNewGroupName('')
              setCreateGroupSelectedIds([])
              setCreateGroupForSchemeId(null)
              setCreateGroupOpen(false)
            },
            createGroupForSchemeId,
          )
        }}
      />

      <EditGroupDialog
        open={editGroupOpen}
        onOpenChange={setEditGroupOpen}
        editGroupName={editGroupName}
        onEditGroupNameChange={setEditGroupName}
        editGroupSelectedIds={editGroupSelectedIds}
        onEditGroupSelectedIdsChange={setEditGroupSelectedIds}
        studentsInClass={studentsInClass}
        isZh={isZh}
        onSave={() => {
          if (editGroupId) {
            handleSaveEditGroup(
              editGroupId,
              editGroupName,
              editGroupSelectedIds,
              () => {
                setEditGroupOpen(false)
                setEditGroupId(null)
                setEditGroupSchemeId(null)
              },
              editGroupSchemeId,
            )
          }
        }}
      />

      <SchemeManagerDialog
        open={schemeManagerOpen}
        onOpenChange={setSchemeManagerOpen}
        selectedSchemeId={selectedSchemeId}
        selectedSchemeName={schemes.find((s) => s.id === selectedSchemeId)?.name ?? ''}
        classId={currentClass?.id ?? ''}
        studentsInClass={studentsInClass}
        dataVersion={dataVersion}
        isZh={isZh}
        onCreateGroup={(schemeId) => {
          setSchemeManagerOpen(false)
          openCreateGroup(schemeId)
        }}
        onEditGroup={(groupId, schemeId, groupsToUse, membersToUse) => {
          setSchemeManagerOpen(false)
          openEditGroup(groupId, groupsToUse, membersToUse, schemeId)
        }}
      />

      <CreateSchemeDialog
        open={createSchemeOpen}
        onOpenChange={setCreateSchemeOpen}
        newSchemeName={newSchemeName}
        onNewSchemeNameChange={setNewSchemeName}
        isZh={isZh}
        onSubmit={() => {
          handleCreateScheme(newSchemeName, () => {
            setCreateSchemeOpen(false)
            setNewSchemeName('')
          })
        }}
      />
    </div>
  )
}
