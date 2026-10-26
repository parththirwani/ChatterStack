import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Github,
  Search,
  Sparkles,
} from "lucide-react";
import { CouncilStory } from "@/src/components/landing/CouncilStory";
import "./landing.css";

export const metadata: Metadata = {
  title: "ChatterStack | One question, more perspective",
  description:
    "Choose a model for a quick answer, or ask a council of four to examine the same question and combine their findings.",
};

const models = [
  { name: "GPT-6.1 Sol", image: "/openai.svg" },
  { name: "Claude Sonnet 5.5", image: "/claude-mark.svg" },
  { name: "Gemini 4 Argon", image: "/gemini.svg" },
  { name: "DeepSeek V4.1 Flash", image: "/deepseek.svg" },
];

export default function LandingPage() {
  return (
    <div className="landing-page">
      <a className="landing-skip" href="#main">
        Skip to content
      </a>
      <header className="landing-header">
        <Link className="landing-brand" href="/" aria-label="ChatterStack home">
          <Image src="/logo.png" width={30} height={24} alt="" priority />
          <span>ChatterStack</span>
        </Link>
        <nav className="landing-nav" aria-label="Main navigation">
          <a href="#council">Council</a>
          <a href="#how-it-works">Workspace</a>
          <a
            href="https://github.com/parththirwani/ChatterStack"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
          >
            <Github
              className="landing-nav-icon"
              size={16}
              aria-hidden="true"
            />
            <span className="landing-nav-label">GitHub</span>
            <ArrowUpRight
              className="landing-nav-label"
              size={13}
              aria-hidden="true"
            />
          </a>
        </nav>
        <Link className="landing-header-cta" href="/chat">
          Open chat <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </header>

      <main id="main">
        <section className="landing-hero" aria-labelledby="hero-title">
          <div className="landing-hero-inner">
            <div className="landing-hero-copy">
              <p className="landing-kicker">
                <span className="landing-kicker-line" /> A clearer way to think
                with AI
              </p>
              <h1 id="hero-title">
                One question.
                <br />
                <span>More perspective.</span>
              </h1>
              <p className="landing-hero-description">
                Choose a model, or ask four together. Sign in with Google or
                GitHub to begin.
              </p>
              <div className="landing-hero-actions">
                <Link
                  className="landing-button landing-button-primary"
                  href="/chat"
                >
                  Open chat <ArrowRight size={17} aria-hidden="true" />
                </Link>
                <a className="landing-text-link" href="#council">
                  Explore the council{" "}
                  <ArrowUpRight size={13} aria-hidden="true" />
                </a>
              </div>
            </div>
            <div
              className="landing-hero-visual"
              aria-label="Illustration of the ChatterStack interface"
            >
              <div className="landing-preview-glow" />
              <div className="landing-chat-window">
                <div className="landing-window-top">
                  <span className="landing-window-brand">
                    <Image src="/logo.png" width={19} height={16} alt="" />{" "}
                    ChatterStack
                  </span>
                  <span className="landing-window-top-right">New chat</span>
                </div>
                <div className="landing-window-content">
                  <div className="landing-window-prompt">
                    How should I structure a search system for a growing
                    product?
                  </div>
                  <div className="landing-window-answer">
                    <div className="landing-window-answer-heading">
                      <span className="landing-avatar">
                        <Sparkles
                          size={15}
                          strokeWidth={1.5}
                          aria-hidden="true"
                        />
                      </span>
                      <span>AI Council</span>
                      <span className="landing-answer-status">Complete</span>
                    </div>
                    <p>
                      Start with keyword search in the existing database. Log
                      failed queries before deciding whether semantic retrieval
                      is worth adding.
                    </p>
                    <div className="landing-window-note">
                      <span className="landing-note-rule" /> The council weighed
                      an earlier semantic rollout against a simpler first
                      release.
                    </div>
                  </div>
                </div>
                <div className="landing-window-input">
                  <span>Ask a follow-up</span>
                  <span className="landing-window-send" aria-hidden="true">
                    <ArrowUp size={17} strokeWidth={1.8} />
                  </span>
                </div>
              </div>
              <div className="landing-hero-caption">
                <span className="landing-caption-mark" /> Illustrative
                ChatterStack conversation
              </div>
            </div>
          </div>
        </section>

        <section className="landing-models" aria-label="Available models">
          <div className="landing-section-shell landing-models-inner">
            <p>
              Choose a model{" "}
              <br />
              for the work.
            </p>
            <div className="landing-model-list">
              {models.map((model) => (
                <div className="landing-model" key={model.name}>
                  <Image
                    className={
                      model.image === "/openai.svg"
                        ? "landing-provider-light"
                        : undefined
                    }
                    src={model.image}
                    width={21}
                    height={21}
                    alt=""
                  />
                  <span>{model.name}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <CouncilStory />

        <section
          className="landing-approach"
          id="how-it-works"
          aria-labelledby="approach-title"
        >
          <div className="landing-section-shell landing-approach-inner">
            <div className="landing-approach-title">
              <span className="landing-section-index">A space to work</span>
              <h2 id="approach-title">Keep the thread.</h2>
            </div>
            <div className="landing-approach-grid">
              <div>
                <span className="landing-approach-number">01 / 02</span>
                <h3>Choose how deeply to think.</h3>
                <p>
                  Switch models in a conversation and set a supported reasoning
                  level in the picker.
                </p>
                <div className="landing-approach-demo">
                  <Image src="/deepseek.svg" width={17} height={17} alt="" />
                  <span>DeepSeek V4.1 Flash</span>
                  <span>Medium</span>
                </div>
                <div className="landing-approach-outcome">
                  <span>DeepSeek V4.1 Flash · Medium reasoning</span>
                  <p>Let’s compare the search paths before choosing an index.</p>
                </div>
                <span className="landing-approach-caption">
                  Illustrative model choice and reply
                </span>
              </div>
              <div>
                <span className="landing-approach-number">02 / 02</span>
                <h3>Return to an earlier idea.</h3>
                <p>
                  Search saved conversations in the sidebar, then reopen a
                  thread where you left off.
                </p>
                <div className="landing-approach-demo landing-approach-history">
                  <Search size={15} aria-hidden="true" />
                  <span>search</span>
                  <i className="landing-approach-caret" aria-hidden="true" />
                </div>
                <div className="landing-approach-outcome landing-approach-result">
                  <span>Matching conversation</span>
                  <p>
                    <mark>Search</mark> system design
                  </p>
                  <ArrowRight size={15} aria-hidden="true" />
                </div>
                <span className="landing-approach-caption">
                  Illustrative conversation result
                </span>
              </div>
            </div>
          </div>
        </section>

        <section
          className="landing-self-host"
          aria-labelledby="self-host-title"
        >
          <div className="landing-section-shell landing-self-host-inner">
            <div>
              <span className="landing-section-index">Built in the open</span>
              <h2 id="self-host-title">Make it yours.</h2>
              <p>
                ChatterStack is open source. Run it with your own OpenRouter key
                and the services described in the repository.
              </p>
              <a
                href="https://github.com/parththirwani/ChatterStack"
                target="_blank"
                rel="noopener noreferrer"
              >
                View the repository{" "}
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            </div>
            <div className="landing-terminal" aria-label="Docker setup command">
              <div className="landing-terminal-top">
                <span className="landing-terminal-dots">
                  <i />
                  <i />
                  <i />
                </span>
                <span>terminal</span>
              </div>
              <code>
                <span>$</span> docker compose up --build -d
              </code>
              <p>Postgres · Redis · Qdrant · ChatterStack</p>
            </div>
          </div>
        </section>

        <section className="landing-final" aria-labelledby="final-title">
          <div className="landing-section-shell">
            <Image
              className="landing-final-logo"
              src="/logo.png"
              width={42}
              height={33}
              alt=""
            />
            <h2 id="final-title">
              Bring your next question
              <br />
              to the council.
            </h2>
            <Link
              className="landing-button landing-button-primary"
              href="/chat"
            >
              Open chat <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <p>Sign in with Google or GitHub to send a message.</p>
          </div>
        </section>
      </main>
      <footer className="landing-footer">
        <div className="landing-section-shell">
          <span>© {new Date().getFullYear()} ChatterStack</span>
          <a
            href="https://github.com/parththirwani/ChatterStack"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Github size={16} aria-hidden="true" /> Source code
          </a>
        </div>
      </footer>
    </div>
  );
}
