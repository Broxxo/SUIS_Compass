export interface LighthouseFrame {
  id: string;
  titleZh: string;
  titleEn: string;
  bodyZh: string;
  bodyEn: string;
  /** 相对正墙的百分比位置与尺寸 */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LighthouseEntry {
  id: string;
  titleZh: string;
  titleEn: string;
  bodyZh: string;
  bodyEn: string;
}

export interface LighthouseBoard {
  front: LighthouseFrame[];
  left: LighthouseEntry[];
  right: LighthouseEntry[];
}
