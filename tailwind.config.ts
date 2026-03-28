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
			border: 'rgba(16, 185, 129, 0.06)',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				background: '#030A0C',
				foreground: '#FFFFFF',
				/* ── AI Fiesta Design Tokens ── */
				'accent-mint':   '#00FF94',   /* brand green — buttons, borders, glows */
				'accent-neon':   '#00FF94',   /* alias */
				'accent-cyan':   '#00E5FF',   /* secondary highlight */
				'teal-bright':   '#298799',   /* atmospheric teal — background glows */
				'teal-mid':      '#0F4450',   /* mid-depth teal */
				'galaxy-void':   '#030A0C',   /* deepest dark */
				primary: {
					'100': 'rgba(16, 185, 129, 0.1)',
					'200': 'rgba(16, 185, 129, 0.2)',
					DEFAULT: '#10B981', // Emerald Green
					foreground: '#FFFFFF',
					light: '#34D399',
					dark: '#059669'
				},
				secondary: {
					DEFAULT: '#14B8A5', // Teal Accent
					foreground: '#FFFFFF'
				},
				accent: {
					DEFAULT: '#D4A417', // Expert Gold
					foreground: '#0F1420',
					secondary: 'rgba(212, 164, 23, 0.1)'
				},
				destructive: {
					DEFAULT: '#F43F5E', // Rose
					foreground: '#FFFFFF'
				},
				muted: {
					DEFAULT: 'rgba(255, 255, 255, 0.05)',
					foreground: 'rgba(255, 255, 255, 0.6)'
				},
				popover: {
					DEFAULT: '#0D0D0D',
					foreground: '#FFFFFF'
				},
				card: {
					DEFAULT: '#0D0D0D',
					foreground: '#FFFFFF'
				},
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
				success: 'hsl(var(--success))',
				warning: 'hsl(var(--warning))',
				error: 'hsl(var(--error))',
				info: 'hsl(var(--info))',
				gray: {
					'50': 'hsl(var(--gray-50))',
					'100': 'hsl(var(--gray-100))',
					'200': 'hsl(var(--gray-200))',
					'300': 'hsl(var(--gray-300))',
					'400': 'hsl(var(--gray-400))',
					'500': 'hsl(var(--gray-500))',
					'600': 'hsl(var(--gray-600))',
					'700': 'hsl(var(--gray-700))',
					'800': 'hsl(var(--gray-800))',
					'900': 'hsl(var(--gray-900))'
				}
			},
			backgroundImage: {
				'gradient-primary': 'var(--gradient-primary)',
				'gradient-hero': 'var(--gradient-hero)',
				'gradient-subtle': 'var(--gradient-subtle)',
				'gradient-indigo-purple': 'var(--gradient-indigo-purple)',
				'gradient-mesh': 'var(--gradient-mesh)',
				'gradient-shimmer': 'var(--gradient-shimmer)'
			},
			boxShadow: {
				xs: 'none',
				sm: 'none',
				md: 'none',
				lg: 'none',
				xl: 'none',
				'2xl': 'none',
				primary: '0 0 15px rgba(16, 185, 129, 0.15)',
				'primary-lg': '0 0 30px rgba(16, 185, 129, 0.25)',
				glow: '0 0 20px rgba(255, 255, 255, 0.05)',
				'2xs': 'none',
				'emerald-glow': '0 0 20px rgba(16, 185, 129, 0.2)'
			},
			transitionTimingFunction: {
				smooth: 'var(--transition-smooth)'
			},
			borderRadius: {
				lg: 'var(--radius)',
				md: 'calc(var(--radius) - 2px)',
				sm: 'calc(var(--radius) - 4px)'
			},
			keyframes: {
				'accordion-down': {
					from: {
						height: '0',
						opacity: '0'
					},
					to: {
						height: 'var(--radix-accordion-content-height)',
						opacity: '1'
					}
				},
				'accordion-up': {
					from: {
						height: 'var(--radix-accordion-content-height)',
						opacity: '1'
					},
					to: {
						height: '0',
						opacity: '0'
					}
				},
				'fade-in': {
					'0%': {
						opacity: '0',
						transform: 'translateY(20px)'
					},
					'100%': {
						opacity: '1',
						transform: 'translateY(0)'
					}
				},
				'fade-in-up': {
					'0%': {
						opacity: '0',
						transform: 'translateY(30px)'
					},
					'100%': {
						opacity: '1',
						transform: 'translateY(0)'
					}
				},
				'fade-in-down': {
					'0%': {
						opacity: '0',
						transform: 'translateY(-20px)'
					},
					'100%': {
						opacity: '1',
						transform: 'translateY(0)'
					}
				},
				'fade-in-left': {
					'0%': {
						opacity: '0',
						transform: 'translateX(-30px)'
					},
					'100%': {
						opacity: '1',
						transform: 'translateX(0)'
					}
				},
				'fade-in-right': {
					'0%': {
						opacity: '0',
						transform: 'translateX(30px)'
					},
					'100%': {
						opacity: '1',
						transform: 'translateX(0)'
					}
				},
				'scale-in': {
					'0%': {
						transform: 'scale(0.8)',
						opacity: '0'
					},
					'100%': {
						transform: 'scale(1)',
						opacity: '1'
					}
				},
				'scale-out': {
					'0%': {
						transform: 'scale(1)',
						opacity: '1'
					},
					'100%': {
						transform: 'scale(0.95)',
						opacity: '0'
					}
				},
				'slide-up': {
					'0%': {
						transform: 'translateY(100%)',
						opacity: '0'
					},
					'100%': {
						transform: 'translateY(0)',
						opacity: '1'
					}
				},
				'slide-down': {
					'0%': {
						transform: 'translateY(-100%)',
						opacity: '0'
					},
					'100%': {
						transform: 'translateY(0)',
						opacity: '1'
					}
				},
				gradient: {
					'0%, 100%': {
						'background-position': '0% 50%'
					},
					'50%': {
						'background-position': '100% 50%'
					}
				},
				float: {
					'0%, 100%': {
						transform: 'translateY(0px)'
					},
					'50%': {
						transform: 'translateY(-10px)'
					}
				},
				'pulse-glow': {
					'0%, 100%': {
						boxShadow: '0 0 12px hsl(var(--primary) / 0.15)'
					},
					'50%': {
						boxShadow: '0 0 18px hsl(var(--primary) / 0.2)'
					}
				},
				shimmer: {
					'0%': {
						transform: 'translateX(-100%)'
					},
					'100%': {
						transform: 'translateX(100%)'
					}
				},
				'bounce-soft': {
					'0%, 100%': {
						transform: 'translateY(-5%)'
					},
					'50%': {
						transform: 'translateY(0)'
					}
				},
				wiggle: {
					'0%, 100%': {
						transform: 'rotate(-1deg)'
					},
					'50%': {
						transform: 'rotate(1deg)'
					}
				},
				'intelligence-pulse': {
					'0%, 100%': {
						boxShadow: '0 0 15px rgba(168, 85, 247, 0.3), 0 0 30px rgba(168, 85, 247, 0.1)'
					},
					'50%': {
						boxShadow: '0 0 25px rgba(168, 85, 247, 0.5), 0 0 40px rgba(168, 85, 247, 0.2)'
					}
				},
				'verified-check': {
					'0%': {
						transform: 'scale(0)',
						opacity: '0'
					},
					'50%': {
						transform: 'scale(1.2)'
					},
					'100%': {
						transform: 'scale(1)',
						opacity: '1'
					}
				}
			},
			animation: {
				'accordion-down': 'accordion-down 0.3s cubic-bezier(0.87, 0, 0.13, 1)',
				'accordion-up': 'accordion-up 0.3s cubic-bezier(0.87, 0, 0.13, 1)',
				'fade-in': 'fade-in 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
				'fade-in-up': 'fade-in-up 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
				'fade-in-down': 'fade-in-down 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
				'fade-in-left': 'fade-in-left 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
				'fade-in-right': 'fade-in-right 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
				'scale-in': 'scale-in 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
				'scale-out': 'scale-out 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
				'slide-up': 'slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
				'slide-down': 'slide-down 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
				gradient: 'gradient 6s ease infinite',
				'gradient-slow': 'gradient 8s ease infinite',
				float: 'float 6s ease-in-out infinite',
				'pulse-glow': 'pulse-glow 4s ease-in-out infinite',
				shimmer: 'shimmer 2s ease-in-out infinite',
				'bounce-soft': 'bounce-soft 2s ease-in-out infinite',
				wiggle: 'wiggle 1s ease-in-out infinite',
				'shimmer-sweep': 'shimmer-sweep 2s infinite',
				'glow-pulse-teal': 'glow-pulse-teal 2s ease-in-out infinite',
				tilt: 'tilt 0.5s ease-in-out',
				'magnetic-hover': 'magnetic-hover 0.8s ease-in-out',
				ripple: 'ripple 0.6s ease-out',
				'bounce-in': 'bounce-in 2s ease-in-out infinite',
				'slide-fade-up': 'slide-fade-up 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
				'scale-pulse': 'scale-pulse 2s ease-in-out infinite',
				'intelligence-pulse': 'intelligence-pulse 2s ease-in-out infinite',
				'verified-check': 'verified-check 0.4s ease-out'
			},
			backgroundSize: {
				'300%': '300%'
			},
			fontFamily: {
				sans: [
					'"DM Sans"',
					'ui-sans-serif',
					'system-ui',
					'sans-serif'
				],
				serif: [
					'"Instrument Serif"',
					'ui-serif',
					'Georgia',
					'serif'
				],
				mono: [
					'"JetBrains Mono"',
					'ui-monospace',
					'monospace'
				]
			}
		}
	},
	plugins: [require("tailwindcss-animate")],
} satisfies Config;