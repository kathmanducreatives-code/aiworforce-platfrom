import type { Config } from "tailwindcss";

export default {
	darkMode: ["class"],
	content: [
		"./pages/**/*.{ts,tsx}",
		"./components/**/*.{ts,tsx}",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}",
	],
	prefix: "",
	theme: {
		container: {
			center: true,
			padding: '2rem',
			screens: {
				'2xl': '1400px'
			}
		},
		extend: {
			colors: {
				/* ── Core surfaces (CSS variable driven) ── */
				border: 'hsl(var(--border))',
				'border-subtle': 'rgba(255, 255, 255, 0.06)',
				'border-accent': 'rgba(16, 185, 129, 0.25)',
				'border-hairline': 'rgba(255, 255, 255, 0.04)',
				'border-soft': 'rgba(255, 255, 255, 0.08)',
				'border-active': 'rgba(16, 185, 129, 0.35)',

				/* ── Depth layers ── */
				'layer-0': '#030303',
				'layer-1': '#0A0A0A',
				'layer-2': '#111111',
				'layer-3': 'rgba(255, 255, 255, 0.03)',

				/* ── Core tokens ── */
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				background: 'hsl(var(--background))',
				foreground: 'hsl(var(--foreground))',
				'text-tertiary': '#4A4A4A',
				'surface-elevated': '#111111',
				'surface-hover': '#181818',

				/* ── Primary (Emerald) ── */
				primary: {
					'100': 'rgba(16, 185, 129, 0.08)',
					'200': 'rgba(16, 185, 129, 0.15)',
					DEFAULT: 'hsl(var(--primary))',
					foreground: 'hsl(var(--primary-foreground))',
					light: 'hsl(var(--primary-light))',
					dark: 'hsl(var(--primary-dark))'
				},

				/* ── Secondary ── */
				secondary: {
					DEFAULT: 'hsl(var(--secondary))',
					foreground: 'hsl(var(--secondary-foreground))'
				},

				/* ── Accent ── */
				accent: {
					DEFAULT: 'hsl(var(--accent))',
					foreground: 'hsl(var(--accent-foreground))',
					secondary: 'rgba(212, 164, 23, 0.08)'
				},

				/* ── Destructive ── */
				destructive: {
					DEFAULT: 'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))'
				},

				/* ── Muted ── */
				muted: {
					DEFAULT: 'hsl(var(--muted))',
					foreground: 'hsl(var(--muted-foreground))'
				},

				/* ── Popover ── */
				popover: {
					DEFAULT: 'hsl(var(--popover))',
					foreground: 'hsl(var(--popover-foreground))'
				},

				/* ── Card ── */
				card: {
					DEFAULT: 'hsl(var(--card))',
					foreground: 'hsl(var(--card-foreground))'
				},

				/* ── Sidebar ── */
				sidebar: {
					DEFAULT: 'hsl(var(--sidebar-background))',
					foreground: 'hsl(var(--sidebar-foreground))',
					primary: 'hsl(var(--sidebar-primary))',
					'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
					accent: 'hsl(var(--sidebar-accent))',
					'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
					border: 'hsl(var(--sidebar-border))',
					ring: 'hsl(var(--sidebar-ring))'
				},

				/* ── Semantic ── */
				success: 'hsl(var(--success, 160 84% 39%))',
				warning: 'hsl(var(--warning, 38 92% 50%))',
				error: 'hsl(var(--error, 0 72% 50%))',
				info: 'hsl(var(--info, 217 91% 60%))',

				/* ── Gray scale ── */
				gray: {
					'50': 'hsl(var(--gray-50, 0 0% 98%))',
					'100': 'hsl(var(--gray-100, 0 0% 96%))',
					'200': 'hsl(var(--gray-200, 0 0% 90%))',
					'300': 'hsl(var(--gray-300, 0 0% 83%))',
					'400': 'hsl(var(--gray-400, 0 0% 64%))',
					'500': 'hsl(var(--gray-500, 0 0% 45%))',
					'600': 'hsl(var(--gray-600, 0 0% 32%))',
					'700': 'hsl(var(--gray-700, 0 0% 25%))',
					'800': 'hsl(var(--gray-800, 0 0% 15%))',
					'900': 'hsl(var(--gray-900, 0 0% 9%))'
				}
			},

			/* ── Background images ── */
			backgroundImage: {
				'gradient-primary': 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary-light)) 100%)',
				'gradient-hero': 'radial-gradient(ellipse at top, rgba(16, 185, 129, 0.08) 0%, transparent 60%)',
				'gradient-subtle': 'linear-gradient(180deg, rgba(16, 185, 129, 0.04) 0%, transparent 100%)',
			},

			/* ── Box shadows ── */
			boxShadow: {
				'xs': 'none',
				'sm': 'none',
				'md': 'none',
				'lg': 'none',
				'xl': 'none',
				'2xl': 'none',
				'2xs': 'none',
				'primary': '0 0 15px rgba(16, 185, 129, 0.10)',
				'primary-lg': '0 0 30px rgba(16, 185, 129, 0.15)',
				'glow': '0 0 20px rgba(255, 255, 255, 0.03)',
				'emerald-glow': '0 0 30px rgba(16, 185, 129, 0.10)',
			},

			/* ── Border radius ── */
			borderRadius: {
				lg: 'var(--radius)',
				md: 'calc(var(--radius) - 2px)',
				sm: 'calc(var(--radius) - 4px)'
			},

			/* ── Background size ── */
			backgroundSize: {
				'300%': '300%'
			},

			/* ── Fonts ── */
			fontFamily: {
				sans: [
					'"Inter Tight"',
					'"Inter"',
					'ui-sans-serif',
					'system-ui',
					'-apple-system',
					'sans-serif'
				],
				mono: [
					'"JetBrains Mono"',
					'ui-monospace',
					'SFMono-Regular',
					'monospace'
				]
			},

			/* ── Keyframes ── */
			keyframes: {
				'accordion-down': {
					from: { height: '0', opacity: '0' },
					to: { height: 'var(--radix-accordion-content-height)', opacity: '1' }
				},
				'accordion-up': {
					from: { height: 'var(--radix-accordion-content-height)', opacity: '1' },
					to: { height: '0', opacity: '0' }
				},
				'fade-in': {
					'0%': { opacity: '0', transform: 'translateY(16px)' },
					'100%': { opacity: '1', transform: 'translateY(0)' }
				},
				'fade-in-up': {
					'0%': { opacity: '0', transform: 'translateY(20px)' },
					'100%': { opacity: '1', transform: 'translateY(0)' }
				},
				'fade-in-down': {
					'0%': { opacity: '0', transform: 'translateY(-16px)' },
					'100%': { opacity: '1', transform: 'translateY(0)' }
				},
				'fade-in-left': {
					'0%': { opacity: '0', transform: 'translateX(-20px)' },
					'100%': { opacity: '1', transform: 'translateX(0)' }
				},
				'fade-in-right': {
					'0%': { opacity: '0', transform: 'translateX(20px)' },
					'100%': { opacity: '1', transform: 'translateX(0)' }
				},
				'scale-in': {
					'0%': { transform: 'scale(0.92)', opacity: '0' },
					'100%': { transform: 'scale(1)', opacity: '1' }
				},
				'scale-out': {
					'0%': { transform: 'scale(1)', opacity: '1' },
					'100%': { transform: 'scale(0.95)', opacity: '0' }
				},
				'slide-up': {
					'0%': { transform: 'translateY(100%)', opacity: '0' },
					'100%': { transform: 'translateY(0)', opacity: '1' }
				},
				'slide-down': {
					'0%': { transform: 'translateY(-100%)', opacity: '0' },
					'100%': { transform: 'translateY(0)', opacity: '1' }
				},
				gradient: {
					'0%, 100%': { 'background-position': '0% 50%' },
					'50%': { 'background-position': '100% 50%' }
				},
				float: {
					'0%, 100%': { transform: 'translateY(0px)' },
					'50%': { transform: 'translateY(-8px)' }
				},
				'pulse-glow': {
					'0%, 100%': { boxShadow: '0 0 12px rgba(16, 185, 129, 0.10)' },
					'50%': { boxShadow: '0 0 20px rgba(16, 185, 129, 0.18)' }
				},
				'glow-breathe': {
					'0%, 100%': { boxShadow: '0 0 20px rgba(16, 185, 129, 0.06)' },
					'50%': { boxShadow: '0 0 30px rgba(16, 185, 129, 0.12)' }
				},
				shimmer: {
					'0%': { transform: 'translateX(-100%)' },
					'100%': { transform: 'translateX(100%)' }
				},
				'intelligence-pulse': {
					'0%, 100%': { boxShadow: '0 0 12px rgba(168, 85, 247, 0.15)' },
					'50%': { boxShadow: '0 0 20px rgba(168, 85, 247, 0.25)' }
				},
				'verified-check': {
					'0%': { transform: 'scale(0)', opacity: '0' },
					'50%': { transform: 'scale(1.15)' },
					'100%': { transform: 'scale(1)', opacity: '1' }
				}
			},

			/* ── Animation utilities ── */
			animation: {
				'accordion-down': 'accordion-down 0.3s cubic-bezier(0.87, 0, 0.13, 1)',
				'accordion-up': 'accordion-up 0.3s cubic-bezier(0.87, 0, 0.13, 1)',
				'fade-in': 'fade-in 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
				'fade-in-up': 'fade-in-up 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
				'fade-in-down': 'fade-in-down 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
				'fade-in-left': 'fade-in-left 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
				'fade-in-right': 'fade-in-right 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
				'scale-in': 'scale-in 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
				'scale-out': 'scale-out 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
				'slide-up': 'slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
				'slide-down': 'slide-down 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
				'gradient': 'gradient 6s ease infinite',
				'gradient-slow': 'gradient 10s ease infinite',
				'float': 'float 6s ease-in-out infinite',
				'pulse-glow': 'pulse-glow 4s ease-in-out infinite',
				'glow-breathe': 'glow-breathe 6s ease-in-out infinite',
				'shimmer': 'shimmer 2s ease-in-out infinite',
				'slide-fade-up': 'slide-fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
				'scale-pulse': 'scale-pulse 3s ease-in-out infinite',
				'intelligence-pulse': 'intelligence-pulse 3s ease-in-out infinite',
				'verified-check': 'verified-check 0.4s ease-out'
			},
		}
	},
	plugins: [require("tailwindcss-animate")],
} satisfies Config;