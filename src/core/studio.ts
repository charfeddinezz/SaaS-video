export interface StudioOptions {
  durationSec?: number;
  style?: string;
  audience?: string;
}

export interface StudioShot {
  id: string;
  beat: string;
  visualPrompt: string;
  durationSec: number;
}

export interface ShortsPackage {
  id: string;
  topic: string;
  title: string;
  hook: string;
  script: string;
  outline: string[];
  shots: StudioShot[];
  tags: string[];
  durationSec: number;
  style: string;
  audience: string;
  createdAt: string;
  deliverable: 'script-and-storyboard';
}

export function createShortsPackage(topic: string, options: StudioOptions = {}): ShortsPackage {
  const cleanTopic = topic.trim().replace(/\s+/g, ' ');
  if (cleanTopic.length < 3) throw new Error('اكتب موضوعًا من ثلاثة أحرف على الأقل.');

  const durationSec = options.durationSec ?? 45;
  const style = options.style ?? 'وثائقي سينمائي';
  const audience = options.audience ?? 'الجمهور العام';
  const id = `reel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const title = cleanTopic.length > 58 ? `${cleanTopic.slice(0, 55)}...` : cleanTopic;
  const hook = `كل ما تحتاج معرفته عن ${cleanTopic}، في أقل من دقيقة.`;
  const outline = [
    `ابدأ بالسؤال الأهم حول ${cleanTopic}.`,
    'بسّط الفكرة إلى نقطة واحدة واضحة.',
    'اربط الفكرة بمثال قريب من الحياة اليومية.',
    'اختم بخطوة صغيرة يمكن للمشاهد تجربتها.',
  ];
  const narration = [
    hook,
    `قبل أن تبدأ، حدّد ما تريد أن تعرفه عن ${cleanTopic}.`,
    'الفكرة الأساسية أبسط مما تبدو: ركّز على نقطة واحدة، واترك التفاصيل الجانبية لوقت لاحق.',
    'تخيّل موقفًا يوميًا يوضح هذه النقطة؛ المثال القريب يثبت الفكرة أفضل من الشرح الطويل.',
    'جرّب خطوة واحدة اليوم، ولاحظ ما يتغير. ما الجانب الذي تريد أن نوضحه في المرة القادمة؟',
  ];
  const sceneDuration = Math.max(4, Math.floor(durationSec / outline.length));
  const shots = outline.map((beat, index) => ({
    id: `${id}-scene-${index + 1}`,
    beat,
    visualPrompt: `لقطة عمودية 9:16 بأسلوب ${style}، تكوين بصري واضح عن ${cleanTopic}، ${beat}، دون نص داخل الصورة.`,
    durationSec: index === outline.length - 1
      ? durationSec - sceneDuration * (outline.length - 1)
      : sceneDuration,
  }));

  return {
    id,
    topic: cleanTopic,
    title,
    hook,
    script: narration.join('\n\n'),
    outline,
    shots,
    tags: ['فيديو_قصير', 'صناعة_محتوى', 'ريلز'],
    durationSec,
    style,
    audience,
    createdAt: new Date().toISOString(),
    deliverable: 'script-and-storyboard',
  };
}