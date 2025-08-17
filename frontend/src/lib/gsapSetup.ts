// Global GSAP setup: register CSSPlugin once so CSS props like autoAlpha, y, scale, boxShadow work everywhere
import { gsap } from 'gsap';
import { CSSPlugin } from 'gsap/CSSPlugin';

gsap.registerPlugin(CSSPlugin);

export {}; // side-effect module
