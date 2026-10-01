/**
 * 课堂助手数据与业务逻辑 hook
 */
import { useEffect, useMemo, useState } from 'react'
import type { ClassItem, ClassGroup, ClassGroupMembership, ClassGroupScheme, Student } from '../../types/classManagement'
import {
  loadAcademicYears,
  loadAllClasses,
  loadAllClassesSync,
  loadEnrollments,
  loadEnrollmentsSync,
  loadStudents,
  loadStudentsSync,
  loadGroupSchemesByClassSync,
  loadGroupsByClassSync,
  loadGroupMembersByClassSync,
  loadAllGroupsSync,
  loadAllGroupMembersSync,
  loadAllPointEventsSync,
  saveGroups,
  saveGroupSchemes,
  deleteGroupScheme,
  saveGroupMembers,
  savePointEvents,
  getIndividualScoresByClass,
  getGroupScoresByClassAndScheme,
  loadClassAssistantFromCloud,
} from '../../lib/classStorage'
import { playAddSound, playMinusSound, isFeedbackSoundEnabled, setFeedbackSoundEnabled } from '../../lib/feedbackSound'
import { latestAcademicYear } from '../../lib/academicPeriodDefault'
import { STORAGE_KEYS } from '../../lib/constants'

function getLastSelectedClassId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.LAST_SELECTED_CLASS_ID)
  } catch {
    return null
  }
}

function setLastSelectedClassId(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEYS.LAST_SELECTED_CLASS_ID, id)
    else localStorage.removeItem(STORAGE_KEYS.LAST_SELECTED_CLASS_ID)
  } catch {}
}

export function useClassAssistantData(user: { id: string; role: string } | null, isZh: boolean) {
  const [currentYearId, setCurrentYearId] = useState<string | null>(null)
  const [dataVersion, setDataVersion] = useState(0)

  const allClasses = useMemo<ClassItem[]>(() => {
    const classes = loadAllClassesSync()
    if (!currentYearId) return classes
    return classes.filter((c) => c.academicYearId === currentYearId)
  }, [currentYearId, dataVersion])

  const selectableClasses = useMemo(() => {
    if (!user) return []
    if (user.role === 'system-admin' || user.role === 'admin') return allClasses
    return allClasses.filter((c) => c.teacherId === user.id)
  }, [allClasses, user])

  const [selectedClassId, setSelectedClassIdState] = useState<string | null>(() => {
    const last = getLastSelectedClassId()
    return last
  })

  const setSelectedClassId = (id: string | null) => {
    setSelectedClassIdState(id)
    setLastSelectedClassId(id)
  }

  // 课堂助手依赖班级/学生/学籍数据：进入后先从云端拉取写入本地缓存，避免教师端看到空数据
  useEffect(() => {
    if (!user) return
    let cancelled = false
    loadAcademicYears().then((years) => {
      if (!cancelled) setCurrentYearId(latestAcademicYear(years)?.id ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [user?.id])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    Promise.all([
      loadAllClasses(),
      loadStudents(),
      loadEnrollments(currentYearId ?? undefined),
    ]).finally(() => {
      if (cancelled) return
      setDataVersion((v) => v + 1)
    })
    return () => {
      cancelled = true
    }
  }, [user?.id, user?.role, currentYearId])

  useEffect(() => {
    if (!selectableClasses.length) {
      setSelectedClassIdState(null)
      return
    }
    const lastSavedId = getLastSelectedClassId()
    const valid = selectableClasses.some((c) => c.id === selectedClassId)
    if (!valid) {
      const fallback = selectableClasses.some((c) => c.id === lastSavedId)
        ? lastSavedId
        : selectableClasses[0].id
      setSelectedClassIdState(fallback)
      setLastSelectedClassId(fallback)
    }
  }, [selectableClasses, selectedClassId])

  const currentClass = useMemo(
    () => selectableClasses.find((c) => c.id === selectedClassId) ?? null,
    [selectableClasses, selectedClassId],
  )

  const studentsInClass = useMemo(() => {
    if (!currentClass) return [] as Student[]
    const enrolls = loadEnrollmentsSync(currentClass.academicYearId).filter(
      (e) => e.classId === currentClass.id,
    )
    const allStudents = loadStudentsSync()
    return enrolls
      .map((e) => allStudents.find((s) => s.id === e.studentId))
      .filter((s): s is Student => !!s)
  }, [currentClass, dataVersion])

  const individualScores = useMemo(
    () => (currentClass ? getIndividualScoresByClass(currentClass.id) : new Map<string, number>()),
    [currentClass, dataVersion],
  )

  const [schemeId, setSchemeId] = useState<string | null>(null)
  const [floatingDeltas, setFloatingDeltas] = useState<{ id: string; groupId: string; delta: number }[]>([])
  const [soundOn, setSoundOn] = useState(isFeedbackSoundEnabled)
  const [deniedStudentId, setDeniedStudentId] = useState<string | null>(null)

  const schemes = useMemo(() => {
    if (!currentClass) return []
    return loadGroupSchemesByClassSync(currentClass.id)
  }, [currentClass, dataVersion])

  const selectedSchemeId = schemeId ?? (schemes[0]?.id ?? null)

  const groups = useMemo(() => {
    if (!currentClass || !selectedSchemeId) return []
    return loadGroupsByClassSync(currentClass.id, selectedSchemeId)
  }, [currentClass, dataVersion, selectedSchemeId])

  const groupMembers = useMemo(
    () =>
      currentClass && selectedSchemeId
        ? loadGroupMembersByClassSync(currentClass.id, selectedSchemeId)
        : [],
    [currentClass, dataVersion, selectedSchemeId],
  )

  const groupScores = useMemo(
    () =>
      currentClass && selectedSchemeId
        ? getGroupScoresByClassAndScheme(currentClass.id, selectedSchemeId)
        : new Map<string, number>(),
    [currentClass, dataVersion, selectedSchemeId],
  )

  useEffect(() => {
    if (!currentClass) {
      setSchemeId(null)
      return
    }
    let cancelled = false
    loadClassAssistantFromCloud(currentClass.id).then(() => {
      if (cancelled) return
      const list = loadGroupSchemesByClassSync(currentClass!.id)
      if (list.length === 0) {
        const now = new Date().toISOString()
        const s: ClassGroupScheme = {
          id: `scheme-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          classId: currentClass!.id,
          name: isZh ? '默认分组' : 'Default scheme',
          scope: 'class-default',
          subject: null,
          createdAt: now,
          updatedAt: now,
        }
        void saveGroupSchemes([s])
        setSchemeId(s.id)
      } else if (!schemeId || !list.some((x) => x.id === schemeId)) {
        setSchemeId(list[0].id)
      }
      setDataVersion((v) => v + 1)
    })
    return () => {
      cancelled = true
    }
  }, [currentClass?.id, isZh])

  const handleAddStudentPoint = (studentId: string, delta: number) => {
    if (!currentClass) return
    const scores = getIndividualScoresByClass(currentClass.id)
    const currentScore = scores.get(studentId) ?? 0
    if (delta < 0 && currentScore + delta < 0) {
      setDeniedStudentId(studentId)
      setTimeout(() => setDeniedStudentId(null), 400)
      playMinusSound()
      return
    }
    const newEvent = {
      id: `pt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      classId: currentClass.id,
      type: 'individual' as const,
      studentId,
      delta,
      createdAt: new Date().toISOString(),
    }
    const all = loadAllPointEventsSync()
    void savePointEvents([...all, newEvent], currentClass.id)
    setDataVersion((v) => v + 1)
    if (delta > 0) playAddSound()
    else playMinusSound()
  }

  const handleAddGroupPoint = (groupId: string, delta: number) => {
    if (!currentClass || !selectedSchemeId) return
    const scores = getGroupScoresByClassAndScheme(currentClass.id, selectedSchemeId)
    const currentScore = scores.get(groupId) ?? 0
    if (delta < 0 && currentScore + delta < 0) {
      const floatId = `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      setFloatingDeltas((prev) => [...prev, { id: floatId, groupId, delta }])
      setTimeout(() => setFloatingDeltas((prev) => prev.filter((f) => f.id !== floatId)), 900)
      playMinusSound()
      return
    }
    const newEvent = {
      id: `pt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      classId: currentClass.id,
      schemeId: selectedSchemeId,
      type: 'group' as const,
      groupId,
      delta,
      createdAt: new Date().toISOString(),
    }
    const all = loadAllPointEventsSync()
    void savePointEvents([...all, newEvent], currentClass.id)
    setDataVersion((v) => v + 1)

    const floatId = `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setFloatingDeltas((prev) => [...prev, { id: floatId, groupId, delta }])
    setTimeout(() => setFloatingDeltas((prev) => prev.filter((f) => f.id !== floatId)), 900)

    if (delta > 0) playAddSound()
    else playMinusSound()
  }

  const handleCreateGroup = (
    newGroupName: string,
    createGroupSelectedIds: string[],
    onSuccess: () => void,
    overrideSchemeId?: string | null,
  ) => {
    const scheme = overrideSchemeId ?? selectedSchemeId
    if (!currentClass || !scheme) return
    const name = newGroupName.trim()
    if (!name) return
    const all = loadGroupsByClassSync(currentClass.id, scheme)
    const now = new Date().toISOString()
    const g: ClassGroup = {
      id: `grp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      classId: currentClass.id,
      schemeId: scheme,
      name,
      scope: 'class-default',
      subject: null,
      createdAt: now,
      updatedAt: now,
    }
    const allGroups = [...all, g]
    const allGlobal = loadAllGroupsSync()
    const rest = allGlobal.filter(
      (x) => !(x.classId === currentClass.id && x.schemeId === scheme),
    )
    // 云端同步必须先写 groups 再写 members，否则会触发 FK（members.group_id -> class_groups.id）
    const syncGroupsAndMaybeMembers = async () => {
      await saveGroups([...rest, ...allGroups], currentClass.id, scheme)

      if (createGroupSelectedIds.length > 0) {
        const allMembers = loadGroupMembersByClassSync(currentClass.id, scheme)
        for (const stuId of createGroupSelectedIds) {
          for (const m of allMembers) {
            if (m.studentId === stuId && !m.leftAt) m.leftAt = now
          }
          allMembers.push({
            id: `gm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            classId: currentClass.id,
            schemeId: scheme,
            groupId: g.id,
            studentId: stuId,
            joinedAt: now,
            leftAt: null,
          })
        }
        const allGlobalMembers = loadAllGroupMembersSync()
        const restMembers = allGlobalMembers.filter(
          (x) => !(x.classId === currentClass.id && x.schemeId === scheme),
        )
        await saveGroupMembers([...restMembers, ...allMembers], currentClass.id, scheme)
      }
    }
    void syncGroupsAndMaybeMembers()
    setDataVersion((v) => v + 1)
    onSuccess()
  }

  const openEditGroupDialog = (
    groupId: string,
    groups: ClassGroup[],
    groupMembers: ClassGroupMembership[],
    overrideSchemeId?: string | null,
  ) => {
    const scheme = overrideSchemeId ?? selectedSchemeId
    if (!currentClass || !scheme) return null
    const group = groups.find((g) => g.id === groupId && g.schemeId === scheme)
    if (!group) return null
    const now = new Date().toISOString()
    const activeByGroup = new Map<string, string[]>()
    for (const m of groupMembers) {
      if (m.classId !== currentClass.id) continue
      if ((m.schemeId ?? null) !== scheme) continue
      if (m.leftAt && m.leftAt <= now) continue
      const arr = activeByGroup.get(m.groupId) ?? []
      arr.push(m.studentId)
      activeByGroup.set(m.groupId, arr)
    }
    return { groupId: group.id, name: group.name, memberIds: activeByGroup.get(group.id) ?? [] }
  }

  const handleSaveEditGroup = (
    editGroupId: string,
    editGroupName: string,
    editGroupSelectedIds: string[],
    onSuccess: () => void,
    overrideSchemeId?: string | null,
  ) => {
    const scheme = overrideSchemeId ?? selectedSchemeId
    if (!currentClass || !editGroupId || !scheme) return
    const name = editGroupName.trim()
    if (!name) return
    const now = new Date().toISOString()

    const allGroups = loadGroupsByClassSync(currentClass.id, scheme)
    const updatedGroups = allGroups.map((g) =>
      g.id === editGroupId ? { ...g, name, updatedAt: now } : g,
    )
    const allGlobal = loadAllGroupsSync()
    const rest = allGlobal.filter(
      (x) => !(x.classId === currentClass.id && x.schemeId === scheme),
    )
    const syncGroupsAndMembers = async () => {
      // 云端同步必须先写 groups 再写 members，否则会触发 FK（members.group_id -> class_groups.id）
      await saveGroups([...rest, ...updatedGroups], currentClass.id, scheme)

      const allMembers = loadGroupMembersByClassSync(currentClass.id, scheme)
      for (const m of allMembers) {
        if (m.classId === currentClass.id && m.groupId === editGroupId && !m.leftAt) m.leftAt = now
      }
      for (const stuId of editGroupSelectedIds) {
        allMembers.push({
          id: `gm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          classId: currentClass.id,
          schemeId: scheme,
          groupId: editGroupId,
          studentId: stuId,
          joinedAt: now,
          leftAt: null,
        })
      }
      const allGlobalMembers = loadAllGroupMembersSync()
      const restMembers = allGlobalMembers.filter(
        (x) => !(x.classId === currentClass.id && x.schemeId === scheme),
      )
      await saveGroupMembers([...restMembers, ...allMembers], currentClass.id, scheme)
    }
    void syncGroupsAndMembers()
    setDataVersion((v) => v + 1)
    onSuccess()
  }

  const handleCreateScheme = (newSchemeName: string, onSuccess: () => void) => {
    if (!currentClass) return
    const name = newSchemeName.trim()
    if (!name) return
    const now = new Date().toISOString()
    const s: ClassGroupScheme = {
      id: `scheme-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      classId: currentClass.id,
      name,
      scope: 'class-default',
      subject: null,
      createdAt: now,
      updatedAt: now,
    }
    void saveGroupSchemes([s])
    setSchemeId(s.id)
    setDataVersion((v) => v + 1)
    onSuccess()
  }

  const handleDeleteScheme = async (schemeIdToDelete: string) => {
    if (schemes.length <= 1) return
    await deleteGroupScheme(schemeIdToDelete)
    if (selectedSchemeId === schemeIdToDelete) {
      const rest = schemes.filter((x) => x.id !== schemeIdToDelete)
      setSchemeId(rest[0]?.id ?? null)
    }
    setDataVersion((v) => v + 1)
  }

  const toggleSound = () => {
    const next = !soundOn
    setSoundOn(next)
    setFeedbackSoundEnabled(next)
  }

  return {
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
    setDataVersion,
    handleAddStudentPoint,
    handleAddGroupPoint,
    handleCreateGroup,
    openEditGroupDialog,
    handleSaveEditGroup,
    handleCreateScheme,
    handleDeleteScheme,
  }
}
