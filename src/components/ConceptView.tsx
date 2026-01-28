import { useState, useEffect, useRef } from 'react';
import { Course, Unit } from '../types';
import { Sparkles, X, Info } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { GRADES, SEMESTERS, GRADE_LABELS, SEMESTER_LABELS } from '../lib/constants';
import { getKeyConcepts } from '../lib/utils';
import { loadSemesterDataSync } from '../lib/storage';

interface ConceptViewProps {
  courses: Course[];
  selectedSemester: { grade: number; semester: 'Semester 1' | 'Semester 2' } | null;
  onSemesterChange: (semester: { grade: number; semester: 'Semester 1' | 'Semester 2' }) => void;
}

interface ConceptNode {
  id: string;
  name: string;
  normalizedName: string;
  units: Array<{
    unit: Unit;
    course: Course;
    grade: number;
    semester: 'Semester 1' | 'Semester 2';
  }>;
  crossSubjectCount: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

interface UnitNode {
  id: string;
  unit: Unit;
  course: Course;
  grade: number;
  semester: 'Semester 1' | 'Semester 2';
  conceptId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  angle: number;
}


function normalizeConcept(concept: string): string {
  // Extract English part if exists (format: "中文 English")
  const englishPart = concept.includes(' ') ? concept.split(' ').slice(1).join(' ').toLowerCase() : concept.toLowerCase();
  return englishPart.trim();
}

export default function ConceptView({ courses, selectedSemester, onSemesterChange }: ConceptViewProps) {
  const { t, language } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [conceptNodes, setConceptNodes] = useState<ConceptNode[]>([]);
  const [unitNodes, setUnitNodes] = useState<UnitNode[]>([]);
  const [selectedConcept, setSelectedConcept] = useState<ConceptNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const dragNodeRef = useRef<string | null>(null);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const redrawRef = useRef<(() => void) | null>(null);

  // Resize canvas to fit container
  useEffect(() => {
    const resizeCanvas = () => {
      if (canvasRef.current && containerRef.current) {
        const container = containerRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        // Set up high DPI rendering
        const dpr = window.devicePixelRatio || 1;
        const width = container.clientWidth;
        const height = container.clientHeight;
        
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        
        // Enable text rendering optimizations
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        // Re-center concept nodes in horizontal ellipse with random distribution
        if (conceptNodes.length > 0) {
          const centerX = width / 2;
          const centerY = height / 2;
          const ellipseRadiusX = Math.min(width * 0.45, 400);
          const ellipseRadiusY = Math.min(height * 0.35, 250);
          
          // Helper function to check overlap
          const checkOverlap = (x: number, y: number, radius: number, existing: ConceptNode[]): boolean => {
            for (const existingConcept of existing) {
              const dx = x - existingConcept.x;
              const dy = y - existingConcept.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              const minDist = radius + existingConcept.radius + 15;
              if (dist < minDist) return true;
            }
            return false;
          };
          
          setConceptNodes(prev => {
            const updated: ConceptNode[] = [];
            prev.forEach((concept) => {
              let attempts = 0;
              let placed = false;
              let x = concept.x;
              let y = concept.y;
              
              while (!placed && attempts < 100) {
                const angle = Math.random() * Math.PI * 2;
                const t = Math.random();
                const distanceFactor = Math.pow(t, 0.7);
                x = centerX + ellipseRadiusX * distanceFactor * Math.cos(angle);
                y = centerY + ellipseRadiusY * distanceFactor * Math.sin(angle);
                
                if (!checkOverlap(x, y, concept.radius, updated)) {
                  placed = true;
                }
                attempts++;
              }
              
              // Fallback: keep original position if couldn't place
              if (!placed) {
                x = concept.x;
                y = concept.y;
              }
              
              updated.push({
                ...concept,
                x,
                y,
                vx: 0,
                vy: 0,
              });
            });
            
            // Update unit nodes positions based on updated concept positions (only if there are units)
            if (unitNodes.length > 0) {
              setUnitNodes(prevUnits => prevUnits.map(unit => {
                const concept = updated.find(c => c.id === unit.conceptId);
                if (concept) {
                  const conceptUnits = concept.units || [];
                  const unitIndex = conceptUnits.findIndex(u => u.unit.id === unit.unit.id);
                  const angle = unitIndex >= 0 ? (unitIndex / conceptUnits.length) * Math.PI * 2 : unit.angle;
                  return {
                    ...unit,
                    x: concept.x + (concept.radius + 32) * Math.cos(angle),
                    y: concept.y + (concept.radius + 32) * Math.sin(angle),
                    vx: 0,
                    vy: 0,
                    angle,
                  };
                }
                return unit;
              }));
            }
            
            return updated;
          });
        }
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [conceptNodes.length, unitNodes.length]);

  // Load units and build concept network based on selected semester
  useEffect(() => {
    const conceptMap = new Map<string, ConceptNode>();

    // 如果没有选择学期，显示所有16个概念在初始位置（椭圆形随机分布）
    if (!selectedSemester) {
      const initialCenterX = 400;
      const initialCenterY = 300;
      const ellipseRadiusX = 350; // Horizontal radius (wider)
      const ellipseRadiusY = 200; // Vertical radius (narrower)
      
      // Helper function to check if a position overlaps with existing concepts
      const checkOverlap = (x: number, y: number, radius: number, existing: ConceptNode[]): boolean => {
        for (const existingConcept of existing) {
          const dx = x - existingConcept.x;
          const dy = y - existingConcept.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const minDist = radius + existingConcept.radius + 15; // Minimum spacing
          if (dist < minDist) {
            return true; // Overlaps
          }
        }
        return false;
      };
      
      const defaultConcepts: ConceptNode[] = [];
      const keyConcepts = getKeyConcepts();
      keyConcepts.forEach((concept) => {
        const normalized = normalizeConcept(concept);
        let attempts = 0;
        let placed = false;
        let x = 0;
        let y = 0;
        
        while (!placed && attempts < 100) {
          // Generate random angle and distance within ellipse
          const angle = Math.random() * Math.PI * 2;
          const t = Math.random(); // 0 to 1
          // Use t^0.7 to bias towards outer edge (more spread out)
          const distanceFactor = Math.pow(t, 0.7);
          
          // Ellipse parametric equation
          x = initialCenterX + ellipseRadiusX * distanceFactor * Math.cos(angle);
          y = initialCenterY + ellipseRadiusY * distanceFactor * Math.sin(angle);
          
          // Check overlap with already placed concepts
          if (!checkOverlap(x, y, 38, defaultConcepts)) {
            placed = true;
          }
          attempts++;
        }
        
        // Fallback: if couldn't place after 100 attempts, use evenly spaced on ellipse
        if (!placed) {
          const index = defaultConcepts.length;
          const angle = (index / keyConcepts.length) * Math.PI * 2;
          x = initialCenterX + ellipseRadiusX * 0.8 * Math.cos(angle);
          y = initialCenterY + ellipseRadiusY * 0.8 * Math.sin(angle);
        }
        
        defaultConcepts.push({
          id: normalized,
          name: concept,
          normalizedName: normalized,
          units: [],
          crossSubjectCount: 0,
          x,
          y,
          vx: 0,
          vy: 0,
          radius: 38, // 默认半径（略大以容纳英文两行）
        });
      });
      
      setConceptNodes(defaultConcepts);
      setUnitNodes([]);
      return;
    }

    // 如果选择了学期，只加载该学期的数据
    courses.forEach((course) => {
      const semesterData = loadSemesterDataSync(course.id, selectedSemester.grade, selectedSemester.semester);
      if (semesterData && semesterData.units && semesterData.units.length > 0) {
        semesterData.units.forEach((unit) => {
          unit.keyConcepts.forEach((concept) => {
            const normalized = normalizeConcept(concept);
            if (!conceptMap.has(normalized)) {
              conceptMap.set(normalized, {
                id: normalized,
                name: concept,
                normalizedName: normalized,
                units: [],
                crossSubjectCount: 0,
                x: 0,
                y: 0,
                vx: 0,
                vy: 0,
                radius: 0,
              });
            }
            const conceptNode = conceptMap.get(normalized)!;
            conceptNode.units.push({
              unit,
              course,
              grade: selectedSemester.grade,
              semester: selectedSemester.semester,
            });
          });
        });
      }
    });

    // Calculate cross-subject count and radius (slower growth with connections)
    const concepts = Array.from(conceptMap.values()).map((concept) => {
      const uniqueCourses = new Set(concept.units.map((u) => u.course.id));
      concept.crossSubjectCount = uniqueCourses.size;
      const baseRadius = Math.max(24, Math.min(46, 24 + concept.units.length * 1));
      concept.radius = baseRadius * 1.42;
      return concept;
    });

    // Filter out concepts with no units (only show concepts that appear in this semester)
    const filteredConcepts = concepts.filter((c) => c.units.length > 0);

    // Initialize positions in a horizontal ellipse with random distribution
    // Ellipse: wider horizontally, narrower vertically
    const initialCenterX = 400;
    const initialCenterY = 300;
    const ellipseRadiusX = 350; // Horizontal radius (wider)
    const ellipseRadiusY = 200; // Vertical radius (narrower)
    
    // Helper function to check if a position overlaps with existing concepts
    const checkOverlap = (x: number, y: number, radius: number, existing: ConceptNode[]): boolean => {
      for (const existingConcept of existing) {
        const dx = x - existingConcept.x;
        const dy = y - existingConcept.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = radius + existingConcept.radius + 15; // Minimum spacing
        if (dist < minDist) {
          return true; // Overlaps
        }
      }
      return false;
    };
    
    // Place concepts randomly in ellipse, avoiding overlaps
    filteredConcepts.forEach((concept) => {
      let attempts = 0;
      let placed = false;
      
      while (!placed && attempts < 100) {
        // Generate random angle and distance within ellipse
        const angle = Math.random() * Math.PI * 2;
        const t = Math.random(); // 0 to 1
        // Use t^0.7 to bias towards outer edge (more spread out)
        const distanceFactor = Math.pow(t, 0.7);
        
        // Ellipse parametric equation
        const x = initialCenterX + ellipseRadiusX * distanceFactor * Math.cos(angle);
        const y = initialCenterY + ellipseRadiusY * distanceFactor * Math.sin(angle);
        
        // Check overlap with already placed concepts
        if (!checkOverlap(x, y, concept.radius, filteredConcepts.filter(c => c.x !== 0 || c.y !== 0))) {
          concept.x = x;
          concept.y = y;
          placed = true;
        }
        attempts++;
      }
      
      // Fallback: if couldn't place after 100 attempts, use evenly spaced on ellipse
      if (!placed) {
        const index = filteredConcepts.indexOf(concept);
        const angle = (index / filteredConcepts.length) * Math.PI * 2;
        concept.x = initialCenterX + ellipseRadiusX * 0.8 * Math.cos(angle);
        concept.y = initialCenterY + ellipseRadiusY * 0.8 * Math.sin(angle);
      }
    });

    setConceptNodes(filteredConcepts);

    // Create unit nodes around concepts
    const units: UnitNode[] = [];
    filteredConcepts.forEach((concept) => {
      concept.units.forEach((unitData, index) => {
        const angle = (index / concept.units.length) * Math.PI * 2;
        units.push({
          id: `${concept.id}-${unitData.unit.id}`,
          unit: unitData.unit,
          course: unitData.course,
          grade: unitData.grade,
          semester: unitData.semester,
          conceptId: concept.id,
          x: concept.x + (concept.radius + 32) * Math.cos(angle),
          y: concept.y + (concept.radius + 32) * Math.sin(angle),
          vx: 0,
          vy: 0,
          radius: 12,
          angle,
        });
      });
    });
    setUnitNodes(units);
  }, [courses, selectedSemester]);

  // Force-directed graph simulation
  useEffect(() => {
    if (!canvasRef.current || conceptNodes.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set up high DPI rendering for crisp text
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const logicalWidth = rect.width;
    const logicalHeight = rect.height;
    
    // Scale canvas for high DPI displays
    canvas.width = logicalWidth * dpr;
    canvas.height = logicalHeight * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = `${logicalWidth}px`;
    canvas.style.height = `${logicalHeight}px`;
    
    // Enable text rendering optimizations
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    let nodes = [...conceptNodes, ...unitNodes];
    const links: Array<{ source: ConceptNode; target: UnitNode }> = [];
    unitNodes.forEach((unit) => {
      const concept = conceptNodes.find((c) => c.id === unit.conceptId);
      if (concept) {
        links.push({ source: concept, target: unit });
      }
    });
    
    // Redraw function (defined outside simulation so it can be stored in ref)
    const redraw = () => {
      // Clear canvas with transparent background (will show container's gradient)
      ctx.clearRect(0, 0, logicalWidth, logicalHeight);

      // Draw links (bottom layer)
      links.forEach((link) => {
        ctx.beginPath();
        ctx.moveTo(link.source.x, link.source.y);
        ctx.lineTo(link.target.x, link.target.y);
        ctx.strokeStyle = hoveredNode === link.source.id || hoveredNode === link.target.id
          ? 'rgba(59, 130, 246, 0.6)'
          : 'rgba(200, 200, 200, 0.3)';
        ctx.lineWidth = hoveredNode === link.source.id || hoveredNode === link.target.id ? 2 : 1;
        ctx.stroke();
      });

      // Draw unit nodes (middle layer)
      unitNodes.forEach((unit) => {
        const isHovered = hoveredNode === unit.id;
        const isConceptSelected = selectedConcept?.id === unit.conceptId;

        ctx.beginPath();
        ctx.arc(unit.x, unit.y, unit.radius, 0, Math.PI * 2);
        
        const getColorGradient = (color: Course['color']) => {
          const gradients: Record<Course['color'], { medium: string; dark: string }> = {
            'light-blue': { medium: '#93c5fd', dark: '#60a5fa' },
            'light-green': { medium: '#86efac', dark: '#4ade80' },
            'light-yellow': { medium: '#fde047', dark: '#facc15' },
            'light-red': { medium: '#fca5a5', dark: '#f87171' },
            'light-purple': { medium: '#c4b5fd', dark: '#a78bfa' },
            'light-orange': { medium: '#fdba74', dark: '#fb923c' },
            'light-cyan': { medium: '#67e8f9', dark: '#22d3ee' },
            'light-pink': { medium: '#f9a8d4', dark: '#f472b6' },
            'light-indigo': { medium: '#a5b4fc', dark: '#818cf8' },
          };
          return gradients[color];
        };
        const gradient = getColorGradient(unit.course.color);
        ctx.fillStyle = isHovered || isConceptSelected ? gradient.dark : gradient.medium;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });

      // Draw concept nodes (top layer - always visible, never obscured)
      conceptNodes.forEach((concept) => {
        const isSelected = selectedConcept?.id === concept.id;
        const isHovered = hoveredNode === concept.id;

        // Outer glow for selected/hovered
        if (isSelected || isHovered) {
          ctx.beginPath();
          ctx.arc(concept.x, concept.y, concept.radius + 5, 0, Math.PI * 2);
          ctx.fillStyle = isSelected ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.2)';
          ctx.fill();
        }

        // Concept node circle with 3D effect
        if (concept.crossSubjectCount >= 3) {
          // 3D purple for 3+ subjects
          // Main sphere with 3D gradient
          const gradient = ctx.createRadialGradient(
            concept.x - concept.radius * 0.4,
            concept.y - concept.radius * 0.4,
            0,
            concept.x,
            concept.y,
            concept.radius
          );
          gradient.addColorStop(0, '#c4b5fd'); // Light purple top
          gradient.addColorStop(0.5, '#a78bfa'); // Medium purple middle
          gradient.addColorStop(1, '#8b5cf6'); // Darker purple bottom
          ctx.beginPath();
          ctx.arc(concept.x, concept.y, concept.radius, 0, Math.PI * 2);
          ctx.fillStyle = gradient;
          ctx.fill();
          
          // Highlight for 3D effect
          const highlightGradient = ctx.createRadialGradient(
            concept.x - concept.radius * 0.3,
            concept.y - concept.radius * 0.3,
            0,
            concept.x - concept.radius * 0.3,
            concept.y - concept.radius * 0.3,
            concept.radius * 0.6
          );
          highlightGradient.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
          highlightGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
          ctx.beginPath();
          ctx.arc(concept.x - concept.radius * 0.3, concept.y - concept.radius * 0.3, concept.radius * 0.6, 0, Math.PI * 2);
          ctx.fillStyle = highlightGradient;
          ctx.fill();
          
          // Shadow for depth
          const shadowGradient = ctx.createRadialGradient(
            concept.x + concept.radius * 0.2,
            concept.y + concept.radius * 0.2,
            0,
            concept.x + concept.radius * 0.2,
            concept.y + concept.radius * 0.2,
            concept.radius * 0.8
          );
          shadowGradient.addColorStop(0, 'rgba(139, 92, 246, 0.3)');
          shadowGradient.addColorStop(1, 'rgba(139, 92, 246, 0)');
          ctx.beginPath();
          ctx.arc(concept.x + concept.radius * 0.2, concept.y + concept.radius * 0.2, concept.radius * 0.8, 0, Math.PI * 2);
          ctx.fillStyle = shadowGradient;
          ctx.fill();
          
          // Border
          ctx.strokeStyle = isSelected ? '#7c3aed' : '#8b5cf6';
          ctx.lineWidth = isSelected ? 4 : 2;
          ctx.beginPath();
          ctx.arc(concept.x, concept.y, concept.radius, 0, Math.PI * 2);
          ctx.stroke();
        } else if (concept.crossSubjectCount === 2) {
          // 3D blue for 2 subjects
          // Main sphere with 3D gradient
          const gradient = ctx.createRadialGradient(
            concept.x - concept.radius * 0.4,
            concept.y - concept.radius * 0.4,
            0,
            concept.x,
            concept.y,
            concept.radius
          );
          gradient.addColorStop(0, '#93c5fd'); // Light blue top
          gradient.addColorStop(0.5, '#60a5fa'); // Medium blue middle
          gradient.addColorStop(1, '#3b82f6'); // Darker blue bottom
          ctx.beginPath();
          ctx.arc(concept.x, concept.y, concept.radius, 0, Math.PI * 2);
          ctx.fillStyle = gradient;
          ctx.fill();
          
          // Highlight for 3D effect
          const highlightGradient = ctx.createRadialGradient(
            concept.x - concept.radius * 0.3,
            concept.y - concept.radius * 0.3,
            0,
            concept.x - concept.radius * 0.3,
            concept.y - concept.radius * 0.3,
            concept.radius * 0.6
          );
          highlightGradient.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
          highlightGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
          ctx.beginPath();
          ctx.arc(concept.x - concept.radius * 0.3, concept.y - concept.radius * 0.3, concept.radius * 0.6, 0, Math.PI * 2);
          ctx.fillStyle = highlightGradient;
          ctx.fill();
          
          // Shadow for depth
          const shadowGradient = ctx.createRadialGradient(
            concept.x + concept.radius * 0.2,
            concept.y + concept.radius * 0.2,
            0,
            concept.x + concept.radius * 0.2,
            concept.y + concept.radius * 0.2,
            concept.radius * 0.5
          );
          shadowGradient.addColorStop(0, 'rgba(0, 0, 0, 0.2)');
          shadowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.beginPath();
          ctx.arc(concept.x + concept.radius * 0.2, concept.y + concept.radius * 0.2, concept.radius * 0.5, 0, Math.PI * 2);
          ctx.fillStyle = shadowGradient;
          ctx.fill();
          
          // Border
          ctx.strokeStyle = isSelected ? '#3b82f6' : '#2563eb';
          ctx.lineWidth = isSelected ? 3 : 2;
          ctx.beginPath();
          ctx.arc(concept.x, concept.y, concept.radius, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          // 3D light gray for single subject
          // Main sphere with 3D gradient
          const gradient = ctx.createRadialGradient(
            concept.x - concept.radius * 0.4,
            concept.y - concept.radius * 0.4,
            0,
            concept.x,
            concept.y,
            concept.radius
          );
          gradient.addColorStop(0, '#e2e8f0'); // Light gray top
          gradient.addColorStop(0.5, '#cbd5e1'); // Medium gray middle
          gradient.addColorStop(1, '#94a3b8'); // Darker gray bottom
          ctx.beginPath();
          ctx.arc(concept.x, concept.y, concept.radius, 0, Math.PI * 2);
          ctx.fillStyle = gradient;
          ctx.fill();
          
          // Highlight for 3D effect
          const highlightGradient = ctx.createRadialGradient(
            concept.x - concept.radius * 0.3,
            concept.y - concept.radius * 0.3,
            0,
            concept.x - concept.radius * 0.3,
            concept.y - concept.radius * 0.3,
            concept.radius * 0.6
          );
          highlightGradient.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
          highlightGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
          ctx.beginPath();
          ctx.arc(concept.x - concept.radius * 0.3, concept.y - concept.radius * 0.3, concept.radius * 0.6, 0, Math.PI * 2);
          ctx.fillStyle = highlightGradient;
          ctx.fill();
          
          // Shadow for depth
          const shadowGradient = ctx.createRadialGradient(
            concept.x + concept.radius * 0.2,
            concept.y + concept.radius * 0.2,
            0,
            concept.x + concept.radius * 0.2,
            concept.y + concept.radius * 0.2,
            concept.radius * 0.5
          );
          shadowGradient.addColorStop(0, 'rgba(0, 0, 0, 0.2)');
          shadowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.beginPath();
          ctx.arc(concept.x + concept.radius * 0.2, concept.y + concept.radius * 0.2, concept.radius * 0.5, 0, Math.PI * 2);
          ctx.fillStyle = shadowGradient;
          ctx.fill();
          
          // Border
          ctx.strokeStyle = isSelected ? '#3b82f6' : '#64748b';
          ctx.lineWidth = isSelected ? 3 : 2;
          ctx.beginPath();
          ctx.arc(concept.x, concept.y, concept.radius, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Concept name - restore original font size, support two-line display for English
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'center';
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        let displayName: string;
        if (concept.name.includes(' ')) {
          const parts = concept.name.split(' ');
          displayName = language === 'zh' ? parts[0] : (parts.slice(1).join(' ') || parts[0]);
        } else {
          displayName = concept.name;
        }
        const fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
        const fontSize = 14;
        ctx.font = `bold ${fontSize}px ${fontFamily}`;
        
        // Check if English has two words (space) - split into two lines
        if (language === 'en' && displayName.includes(' ')) {
          const words = displayName.split(' ');
          const lineHeight = fontSize * 1.2;
          const totalHeight = lineHeight * 2;
          const startY = concept.y - totalHeight / 2 + lineHeight / 2;
          
          // Draw first word
          ctx.textBaseline = 'middle';
          ctx.fillText(words[0], concept.x, startY);
          
          // Draw second word (or remaining words)
          const secondLine = words.slice(1).join(' ');
          ctx.fillText(secondLine, concept.x, startY + lineHeight);
        } else {
          // Single line for Chinese or single-word English
          ctx.textBaseline = 'middle';
          ctx.fillText(displayName, concept.x, concept.y);
        }
      });
    };

    // Store redraw function for drag updates
    redrawRef.current = redraw;

    const simulation = () => {
      // Disable auto-spread: no repulsion between concept nodes
      // Only maintain unit positions relative to their concepts when dragging
      
      // Light attraction between concepts and their units (only if not dragging)
      if (!isDraggingRef.current) {
        links.forEach((link) => {
          const dx = link.target.x - link.source.x;
          const dy = link.target.y - link.source.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const idealDist = link.source.radius + link.target.radius + 25;
          const diff = dist - idealDist;
          const force = diff * 0.02;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          link.target.vx -= fx;
          link.target.vy -= fy;
        });
      }

      // Update positions (only if not dragging)
      if (!isDraggingRef.current) {
        nodes.forEach((node) => {
          node.vx *= 0.95; // Stronger damping to prevent movement
          node.vy *= 0.95;
          node.x += node.vx;
          node.y += node.vy;

          // Boundary constraints (using logical dimensions)
          node.x = Math.max(node.radius, Math.min(logicalWidth - node.radius, node.x));
          node.y = Math.max(node.radius, Math.min(logicalHeight - node.radius, node.y));
        });
      }

      // Call redraw in simulation
      redraw();
    };

    if (!isDraggingRef.current) {
      animationFrameRef.current = requestAnimationFrame(simulation);
    }
    animationFrameRef.current = requestAnimationFrame(simulation);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [conceptNodes, unitNodes, selectedConcept, hoveredNode, language]);

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Record start position for click vs drag detection
    dragStartPosRef.current = { x, y };

    // Check concept nodes first
    for (const concept of conceptNodes) {
      const dist = Math.sqrt((x - concept.x) ** 2 + (y - concept.y) ** 2);
      if (dist <= concept.radius) {
        isDraggingRef.current = true;
        dragNodeRef.current = concept.id;
        dragOffsetRef.current = { x: x - concept.x, y: y - concept.y };
        concept.vx = 0;
        concept.vy = 0;
        return;
      }
    }

    // Check unit nodes
    for (const unit of unitNodes) {
      const dist = Math.sqrt((x - unit.x) ** 2 + (y - unit.y) ** 2);
      if (dist <= unit.radius) {
        isDraggingRef.current = true;
        dragNodeRef.current = unit.id;
        dragOffsetRef.current = { x: x - unit.x, y: y - unit.y };
        unit.vx = 0;
        unit.vy = 0;
        return;
      }
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Handle dragging
    if (isDraggingRef.current && dragNodeRef.current && dragOffsetRef.current) {
      // Find and move concept node
      const concept = conceptNodes.find(c => c.id === dragNodeRef.current);
      if (concept) {
        concept.x = x - dragOffsetRef.current.x;
        concept.y = y - dragOffsetRef.current.y;
        concept.vx = 0;
        concept.vy = 0;
        
        // Move related unit nodes
        const relatedUnits = unitNodes.filter(u => u.conceptId === concept.id);
        relatedUnits.forEach((unit, index) => {
          const angle = (index / relatedUnits.length) * Math.PI * 2;
          unit.x = concept.x + (concept.radius + 32) * Math.cos(angle);
          unit.y = concept.y + (concept.radius + 32) * Math.sin(angle);
          unit.vx = 0;
          unit.vy = 0;
        });
        
        // Force redraw during drag
        if (redrawRef.current) {
          redrawRef.current();
        }
        return;
      }

      // Find and move unit node
      const unit = unitNodes.find(u => u.id === dragNodeRef.current);
      if (unit) {
        unit.x = x - dragOffsetRef.current.x;
        unit.y = y - dragOffsetRef.current.y;
        unit.vx = 0;
        unit.vy = 0;
        
        // Force redraw during drag
        if (redrawRef.current) {
          redrawRef.current();
        }
        return;
      }
    }

    // Hover detection
    let found = false;

    // Check concept nodes
    for (const concept of conceptNodes) {
      const dist = Math.sqrt((x - concept.x) ** 2 + (y - concept.y) ** 2);
      if (dist <= concept.radius) {
        setHoveredNode(concept.id);
        found = true;
        break;
      }
    }

    if (!found) {
      // Check unit nodes
      for (const unit of unitNodes) {
        const dist = Math.sqrt((x - unit.x) ** 2 + (y - unit.y) ** 2);
        if (dist <= unit.radius) {
          setHoveredNode(unit.id);
          found = true;
          break;
        }
      }
    }

    if (!found) {
      setHoveredNode(null);
    }
  };

  const handleCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current || !dragStartPosRef.current || !canvasRef.current) {
      isDraggingRef.current = false;
      dragNodeRef.current = null;
      dragStartPosRef.current = null;
      dragOffsetRef.current = null;
      return;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const endY = e.clientY - rect.top;
    
    // Calculate movement distance
    const moveDist = Math.sqrt(
      (endX - dragStartPosRef.current.x) ** 2 + 
      (endY - dragStartPosRef.current.y) ** 2
    );

    // If moved less than 5 pixels, treat as click
    if (moveDist < 5) {
      // Handle click
      const x = endX;
      const y = endY;
      
      // Check concept nodes first
      for (const concept of conceptNodes) {
        const dist = Math.sqrt((x - concept.x) ** 2 + (y - concept.y) ** 2);
        if (dist <= concept.radius) {
          setSelectedConcept(selectedConcept?.id === concept.id ? null : concept);
          isDraggingRef.current = false;
          dragNodeRef.current = null;
          dragStartPosRef.current = null;
          dragOffsetRef.current = null;
          return;
        }
      }

      setSelectedConcept(null);
    }

    // Reset drag state
    isDraggingRef.current = false;
    dragNodeRef.current = null;
    dragStartPosRef.current = null;
    dragOffsetRef.current = null;
  };

  const handleCanvasClick = () => {
    // Click is now handled in mouseUp, this is just a fallback
    // Don't show panel on click if we just finished dragging
    if (isDraggingRef.current) {
      return;
    }
  };


  return (
    <div className="h-full w-full flex flex-col bg-white">
      {/* Semester Selector */}
      <div className="px-6 py-2 flex-shrink-0">
        <div className="flex items-center gap-3">
          <label className="text-sm font-semibold text-gray-700">{t('semester.select')}:</label>
          <select
            value={selectedSemester ? `${selectedSemester.grade}-${selectedSemester.semester}` : ''}
            onChange={(e) => {
              if (e.target.value) {
                const [grade, semester] = e.target.value.split('-');
                onSemesterChange({ grade: parseInt(grade), semester: semester as 'Semester 1' | 'Semester 2' });
              }
            }}
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">{t('semester.selectPlaceholder')}</option>
            {GRADES.map((grade) =>
              SEMESTERS.map((semester) => (
                <option key={`${grade}-${semester}`} value={`${grade}-${semester}`}>
                  {GRADE_LABELS[grade]} {SEMESTER_LABELS[semester]} (G{grade} {semester})
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col pt-3 px-4 pb-4">
        <div className="h-full w-full border border-gray-200 rounded-xl shadow-sm bg-white flex flex-col overflow-hidden">
          <div className="flex-1 flex justify-center overflow-hidden relative">
            <div className="relative h-full w-full max-w-[95%]">
              {/* Concept Container */}
              <div ref={containerRef} className="relative h-full w-full border-2 border-gray-300 rounded-lg bg-gradient-to-b from-gray-50 to-gray-100 overflow-hidden">
            <canvas
          ref={canvasRef}
          className="w-full h-full cursor-grab active:cursor-grabbing"
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
              onClick={handleCanvasClick}
            />

            {/* Legend */}
        <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm rounded-lg p-3 shadow-lg border border-gray-200">
          <div className="text-xs font-bold text-gray-700 mb-2">{t('concept.legend')}</div>
          <div className="space-y-1.5 text-[10px]">
            <div className="flex items-center gap-2">
              <div className="relative w-4 h-4">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-purple-200 via-purple-300 to-purple-400 shadow-inner" />
                <div className="absolute inset-0.5 rounded-full bg-gradient-to-br from-purple-100 to-purple-300" />
              </div>
              <span>{t('concept.cross3Plus')}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative w-4 h-4">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-200 via-blue-300 to-blue-400 shadow-inner" />
                <div className="absolute inset-0.5 rounded-full bg-gradient-to-br from-blue-100 to-blue-300" />
              </div>
              <span>{t('concept.cross2')}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative w-4 h-4">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-gray-200 via-gray-300 to-gray-400 shadow-inner" />
                <div className="absolute inset-0.5 rounded-full bg-gradient-to-br from-gray-100 to-gray-300" />
              </div>
              <span>{t('concept.single')}</span>
            </div>
            </div>
          </div>

          {/* Selected Concept Panel */}
        {selectedConcept && (
          <div className="absolute bottom-4 left-4 right-4 bg-white/95 backdrop-blur-sm rounded-xl shadow-2xl border border-gray-200 p-4 max-h-[300px] overflow-y-auto">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-blue-600" />
                  {language === 'zh' 
                    ? (selectedConcept.name.includes(' ') ? selectedConcept.name.split(' ')[0] : selectedConcept.name)
                    : (selectedConcept.name.includes(' ') ? selectedConcept.name.split(' ').slice(1).join(' ') : selectedConcept.name)
                  }
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                  {t('concept.connectedUnits')} {selectedConcept.units.length} {t('concept.units')} · {t('concept.crossSubjects')} {selectedConcept.crossSubjectCount} {t('concept.disciplines')}
                </p>
              </div>
              <button
                onClick={() => setSelectedConcept(null)}
                className="p-1 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>

            <div className="space-y-2">
              {selectedConcept.units.map((unitData, index) => (
                <div
                  key={`${unitData.unit.id}-${index}`}
                  className="p-2 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{
                        background: `linear-gradient(135deg, ${
                          unitData.course.color === 'light-blue' ? '#93c5fd, #60a5fa' :
                          unitData.course.color === 'light-green' ? '#86efac, #4ade80' :
                          unitData.course.color === 'light-yellow' ? '#fde047, #facc15' :
                          unitData.course.color === 'light-red' ? '#fca5a5, #f87171' :
                          '#c4b5fd, #a78bfa'
                        })`,
                      }}
                    />
                    <span className="text-xs font-semibold text-gray-700">
                      {unitData.course.name} · G{unitData.grade} {unitData.semester === 'Semester 1' ? t('concept.firstSemester') : t('concept.secondSemester')}
                    </span>
                  </div>
                  <div className="text-sm font-medium text-gray-800">
                    {unitData.unit.title}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {unitData.unit.week}{t('concept.weeks')} · {unitData.unit.periods}{t('concept.periods')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

          {/* Info Tooltip */}
        {conceptNodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center p-6 bg-white/90 backdrop-blur-sm rounded-xl border border-gray-200 shadow-lg">
              <Info className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600 font-medium">{t('concept.noData')}</p>
              <p className="text-sm text-gray-500 mt-1">
                {t('concept.noDataHint')}
              </p>
            </div>
          </div>
        )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
