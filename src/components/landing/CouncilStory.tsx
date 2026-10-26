'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, CornerDownRight } from 'lucide-react';

const steps = [
  {
    number: '01',
    title: 'Start with the question.',
    body: 'Ask as you normally would. A quick answer needs one model; a difficult decision can use the council.',
  },
  {
    number: '02',
    title: 'Hear different angles.',
    body: 'Four models examine the same prompt. Follow each response without switching tabs or losing your place.',
  },
  {
    number: '03',
    title: 'Leave with a synthesis.',
    body: 'The council brings the useful points together and calls out where the answers differ.',
  },
];

const councilModels = [
  { name: 'GPT-6.1 Sol', image: '/openai.svg', note: 'Start with a small, measurable index.' },
  { name: 'Claude Sonnet 5.5', image: '/claude.svg', note: 'Keep the first release easy to operate.' },
  { name: 'Gemini 4 Argon', image: '/gemini.svg', note: 'Test relevance with real product queries.' },
  { name: 'DeepSeek V4.1 Flash', image: '/deepseek.svg', note: 'Add semantic retrieval where it helps.' },
];

export function CouncilStory() {
  const [active, setActive] = useState(0);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(Number((visible.target as HTMLElement).dataset.step));
      },
      { rootMargin: '-25% 0px -35% 0px', threshold: [0, 0.25, 0.5, 0.75] },
    );
    stepRefs.current.forEach((element) => { if (element) observer.observe(element); });
    return () => observer.disconnect();
  }, []);

  return (
    <section className="landing-council" id="council" aria-labelledby="council-title">
      <div className="landing-section-shell landing-council-heading"><span className="landing-section-index">The AI Council</span><h2 id="council-title">One prompt. A wider view.</h2><p>For questions worth a second opinion, bring several models into the same conversation.</p></div>
      <div className="landing-section-shell landing-story-grid">
        <div className="landing-story-steps">
          {steps.map((step, index) => <div className="landing-story-step" key={step.number} data-step={index} ref={(element) => { stepRefs.current[index] = element; }}><span>{step.number} / 03</span><h3>{step.title}</h3><p>{step.body}</p></div>)}
        </div>
        <div className="landing-story-visual-wrap">
          <div className="landing-story-visual" aria-label="Illustrative council response to a product search question">
            <div className="landing-story-toolbar"><span><span className="landing-toolbar-symbol">✳</span> Council session</span><span className="landing-story-live"><i /> {active === 0 ? 'Ready' : active === 1 ? '4 perspectives' : 'Synthesis'}</span></div>
            <div className="landing-story-content">
              <div className="landing-story-question"><span>You asked</span><p>How should I structure a search system for a growing product?</p></div>
              <div className="landing-story-response">
                <div className="landing-story-response-label"><CornerDownRight size={16} aria-hidden="true" /> Council</div>
                {active === 0 ? <div className="landing-story-ready"><span className="landing-story-ready-orbit">✳</span><p>Bring four perspectives to one question.</p><span>Choose Council in the model picker</span></div> : <div className="landing-story-models">{councilModels.map((model) => <div className="landing-story-model" key={model.name}><Image src={model.image} width={20} height={20} alt="" /><div><strong>{model.name}</strong><p>{model.note}</p></div><Check size={15} aria-hidden="true" /></div>)}</div>}
                {active === 2 && <div className="landing-story-synthesis"><span><Image src="/logo.png" width={18} height={15} alt="" /> Combined findings</span><p>Build a simple index first. Measure relevance with real queries, then add semantic retrieval where keyword search falls short.</p></div>}
              </div>
            </div>
            <div className="landing-story-bottom"><span>Illustrative example</span><span>ChatterStack <ArrowRight size={13} aria-hidden="true" /></span></div>
          </div>
        </div>
      </div>
    </section>
  );
}
