"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, CornerDownRight, Sparkles } from "lucide-react";
import { useMotionValueEvent, useScroll } from "framer-motion";

const steps = [
  {
    number: "01",
    title: "Start with the question.",
    body: "Ask as you normally would. A quick answer needs one model; a difficult decision can use the council.",
  },
  {
    number: "02",
    title: "Hear different angles.",
    body: "Four models examine the same prompt. Follow each response without switching tabs or losing your place.",
  },
  {
    number: "03",
    title: "Leave with a synthesis.",
    body: "The council brings the useful points together and calls out where the answers differ.",
  },
];

const councilModels = [
  {
    name: "GPT-6.1 Sol",
    image: "/openai.svg",
    note: "Start with keyword search. It handles names and exact matches well.",
  },
  {
    name: "Claude Sonnet 5.5",
    image: "/claude.svg",
    note: "Keep the first version in your database. One less service to operate.",
  },
  {
    name: "Gemini 4 Argon",
    image: "/gemini.svg",
    note: "Log failed searches. Use real queries to find missing synonyms.",
  },
  {
    name: "DeepSeek V4.1 Flash",
    image: "/deepseek.svg",
    note: "Add embeddings early if users search with natural language.",
  },
];

export function CouncilStory() {
  const [active, setActive] = useState(0);
  const [hasEntered, setHasEntered] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);
  const { scrollY } = useScroll();

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const syncActiveStage = useCallback(() => {
    if (window.matchMedia("(max-width: 767px)").matches) return;
    const stepsOnPage = stepRefs.current.filter(
      (element): element is HTMLDivElement => Boolean(element),
    );
    if (stepsOnPage.length !== steps.length) return;
    const first = stepsOnPage[0].getBoundingClientRect();
    const last = stepsOnPage[stepsOnPage.length - 1].getBoundingClientRect();
    if (
      first.top > window.innerHeight * 0.75 ||
      last.bottom < window.innerHeight * 0.25
    )
      return;
    setHasEntered(true);
    const midpoint = window.innerHeight * 0.5;
    const nearest = stepsOnPage.reduce(
      (best, element, index) => {
        const rect = element.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - midpoint);
        return distance < best.distance ? { index, distance } : best;
      },
      { index: 0, distance: Number.POSITIVE_INFINITY },
    );
    setActive((current) =>
      current === nearest.index ? current : nearest.index,
    );
  }, []);

  useMotionValueEvent(scrollY, "change", syncActiveStage);

  useEffect(() => {
    const frame = window.requestAnimationFrame(syncActiveStage);
    window.addEventListener("resize", syncActiveStage);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", syncActiveStage);
    };
  }, [syncActiveStage]);

  const displayStage = isMobile || !hasEntered ? 2 : active;

  return (
    <section
      className="landing-council"
      id="council"
      aria-labelledby="council-title"
    >
      <div className="landing-section-shell landing-council-heading">
        <span className="landing-section-index">The AI Council</span>
        <h2 id="council-title">One prompt. A wider view.</h2>
        <p>
          For questions worth a second opinion, bring several models into the
          same conversation.
        </p>
      </div>
      <div className="landing-section-shell landing-story-grid">
        <div className="landing-story-steps">
          {steps.map((step, index) => (
            <div
              className="landing-story-step"
              key={step.number}
              data-active={!isMobile && hasEntered && active === index}
              ref={(element) => {
                stepRefs.current[index] = element;
              }}
            >
              <span>{step.number} / 03</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          ))}
          <div className="landing-story-endcap">
            <span>Ready for a wider view?</span>
            <Link href="/chat">
              Open the council <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>
        <div className="landing-story-visual-wrap">
          <div
            className="landing-story-visual"
            data-stage={displayStage}
            aria-label="Illustrative council response to a product search question"
          >
            <div className="landing-story-toolbar">
              <span>
                <Sparkles
                  className="landing-toolbar-symbol"
                  size={17}
                  strokeWidth={1.6}
                  aria-hidden="true"
                />{" "}
                Council session
              </span>
              <span className="landing-story-live">
                <i />{" "}
                {displayStage === 0
                  ? "Council selected"
                  : displayStage === 1
                    ? "4 perspectives"
                    : "Synthesis"}
              </span>
            </div>
            <div className="landing-story-content">
              <div className="landing-story-question">
                <span>01 / The question</span>
                <p>
                  How should I structure a search system for a growing product?
                </p>
              </div>
              <div className="landing-story-response">
                <div className="landing-story-response-label">
                  <CornerDownRight size={16} aria-hidden="true" /> 02 / Four
                  perspectives
                </div>
                <div className="landing-story-models">
                  {councilModels.map((model) => (
                    <div className="landing-story-model" key={model.name}>
                      <Image
                        className={
                          model.image === "/openai.svg"
                            ? "landing-provider-light"
                            : undefined
                        }
                        src={model.image}
                        width={20}
                        height={20}
                        alt=""
                      />
                      <div>
                        <strong>{model.name}</strong>
                        <p>
                          {displayStage === 0
                            ? "Ready to weigh in"
                            : model.note}
                        </p>
                      </div>
                      {displayStage > 0 && (
                        <Check size={15} aria-hidden="true" />
                      )}
                    </div>
                  ))}
                </div>
                {displayStage === 2 && (
                  <div className="landing-story-synthesis">
                    <span>
                      <Image src="/logo.png" width={18} height={15} alt="" /> 03
                      / Combined finding
                    </span>
                    <p>
                      Start with keyword search in the existing database.
                      DeepSeek favors embeddings for natural language queries;
                      the others favor a smaller release. Log failed searches
                      and add semantic retrieval when those queries show a real
                      gap.
                    </p>
                  </div>
                )}
              </div>
            </div>
            <div className="landing-story-bottom">
              <span>Illustrative example</span>
              <span>
                ChatterStack <ArrowRight size={13} aria-hidden="true" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
