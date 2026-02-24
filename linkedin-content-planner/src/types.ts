export interface CarouselSlide {
    slideNumber: number;
    headline: string;
    subtext: string;
    designNote: string;
}

export interface ComicPanel {
    scene: string;
    dialogue: string;
    expression?: string;
}

export interface ComicScript {
    panel1: ComicPanel;
    panel2: ComicPanel;
    panel3: ComicPanel;
    comicImagePrompt: string;
}

export interface DataVisual {
    statNumber: string;
    statContext: string;
    visualPrompt: string;
    caption: string;
}

export interface HotTake {
    headline: string;
    bodyText: string;
    closingCTA: string;
}

export interface Poll {
    question: string;
    option1: string;
    option2: string;
    option3: string;
    option4: string;
    followUpComment: string;
}

export interface VideoIdea {
    concept: string;
    hookLine: string;
    scriptOutline: string;
    closingCTA: string;
}

export interface DayPlan {
    id: string;
    day: string;
    contentFormat: string;
    postCaption: string;
    imagePrompt: string;
    videoIdea: VideoIdea | null;
    carouselScript: CarouselSlide[];
    comicScript: ComicScript | null;
    dataVisual: DataVisual | null;
    hotTake: HotTake | null;
    poll: Poll | null;
    status: "Planned" | "Posted";
    rowIndex: number;
    mediaBase64: string | null;
    mediaName: string | null;
    mediaType: "image" | "video" | null;
    scheduledTime: string;
}
