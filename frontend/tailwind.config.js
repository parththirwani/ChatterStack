/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Base colors
        background: 'hsl(280, 12%, 13%)', // #211c26
        foreground: 'hsl(220, 15%, 85%)',
        
        // Chat colors
        'chat-background': 'hsl(280, 12%, 13%)',
        'chat-surface': 'hsl(280, 8%, 18%)',
        'chat-surface-hover': 'hsl(280, 8%, 22%)',
        
        // Sidebar colors
        'sidebar-bg': 'hsl(280, 15%, 8%)',
        'sidebar-surface': 'hsl(280, 10%, 12%)',
        'sidebar-surface-hover': 'hsl(280, 10%, 16%)',
        
        // Electric Yellow System
        'electric-yellow': 'hsl(52, 100%, 60%)',
        'electric-yellow-dark': 'hsl(45, 100%, 50%)',
        'electric-yellow-glow': 'hsl(52, 100%, 70%)',
        
        // Primary system
        primary: {
          DEFAULT: 'hsl(52, 100%, 60%)',
          foreground: 'hsl(280, 12%, 13%)',
          hover: 'hsl(45, 100%, 50%)',
        },
        
        // Secondary system
        secondary: {
          DEFAULT: 'hsl(280, 8%, 18%)',
          foreground: 'hsl(220, 15%, 85%)',
          hover: 'hsl(280, 8%, 22%)',
        },
        
        // Muted system
        muted: {
          DEFAULT: 'hsl(280, 8%, 18%)',
          foreground: 'hsl(220, 8%, 55%)',
        },
        
        // Accent system
        accent: {
          DEFAULT: 'hsl(52, 100%, 60%)',
          foreground: 'hsl(280, 12%, 13%)',
        },
        
        // Border and input
        border: 'hsl(280, 8%, 25%)',
        input: 'hsl(280, 8%, 18%)',
        'input-border': 'hsl(280, 8%, 30%)',
        'input-focus': 'hsl(52, 100%, 60%)',
        
        // Status colors
        destructive: {
          DEFAULT: 'hsl(0, 70%, 50%)',
          foreground: 'hsl(220, 15%, 85%)',
        },
        success: 'hsl(120, 60%, 50%)',
        warning: 'hsl(45, 90%, 60%)',
        
        // Text colors
        'text-primary': 'hsl(220, 15%, 85%)',
        'text-secondary': 'hsl(220, 8%, 65%)',
        'text-muted': 'hsl(220, 8%, 45%)',
        
        // Ring
        ring: 'hsl(52, 100%, 60%)',
      },
      
      backgroundImage: {
        'gradient-primary': 'linear-gradient(135deg, hsl(52, 100%, 60%), hsl(45, 100%, 50%))',
        'gradient-surface': 'linear-gradient(135deg, hsl(280, 8%, 18%), hsl(280, 10%, 12%))',
      },
      
      boxShadow: {
        'glow': '0 0 20px hsl(52 100% 60% / 0.4)',
        'soft': '0 4px 12px hsl(0 0% 0% / 0.15)',
        'medium': '0 8px 25px hsl(0 0% 0% / 0.25)',
      },
      
      borderRadius: {
        DEFAULT: '0.75rem',
      },
      
      animation: {
        'fade-in': 'fadeIn 0.6s ease-out forwards',
        'slide-down': 'slideDown 0.6s ease-out forwards',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite',
      },
      
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        glowPulse: {
          '0%, 100%': { 
            boxShadow: '0 0 5px hsl(52 100% 60% / 0.5)',
            backgroundColor: 'hsl(52, 100%, 60%)',
          },
          '50%': { 
            boxShadow: '0 0 15px hsl(52 100% 60% / 0.8)',
            backgroundColor: 'hsl(52, 100%, 70%)',
          },
        },
      },
    },
  },
  plugins: [],
}