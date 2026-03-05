import React from 'react';
import {
  FiDatabase,
  FiGrid,
  FiLayers,
  FiZap,
  FiBarChart2,
  FiPieChart,
  FiTrendingUp,
  FiFilter,
  FiShare2,
  FiArrowRight,
  FiPlay,
  FiBook,
  FiCode,
} from 'react-icons/fi';
import { HiSparkles } from 'react-icons/hi2';
import './GettingStarted.css';

const GettingStarted = ({ onSignIn }) => {

  const features = [
    {
      icon: FiDatabase,
      title: 'Connect to Snowflake',
      description: 'Securely connect to your Snowflake data warehouse using PAT tokens or key-pair authentication.',
      color: '#00d4ff',
    },
    {
      icon: FiLayers,
      title: 'Semantic Views',
      description: 'Build on top of Snowflake Semantic Views for governed, reusable data definitions.',
      color: '#10b981',
    },
    {
      icon: FiGrid,
      title: 'Drag & Drop Builder',
      description: 'Create stunning visualizations with an intuitive drag-and-drop interface.',
      color: '#f59e0b',
    },
    {
      icon: HiSparkles,
      title: 'Cortex AI Functions',
      description: 'Enhance your data with AI-powered calculated fields using Snowflake Cortex.',
      color: '#a855f7',
    },
  ];

  const chartTypes = [
    { icon: FiBarChart2, name: 'Bar Charts' },
    { icon: FiPieChart, name: 'Pie & Donut' },
    { icon: FiTrendingUp, name: 'Line & Area' },
    { icon: FiGrid, name: 'Tables & Pivots' },
    { icon: FiShare2, name: 'Sankey Flows' },
    { icon: FiFilter, name: 'Histograms' },
  ];

  const steps = [
    {
      number: '01',
      title: 'Sign In',
      description: 'Connect to Snowflake with your credentials',
      icon: FiPlay,
    },
    {
      number: '02',
      title: 'Select Semantic View',
      description: 'Choose from your available semantic models',
      icon: FiLayers,
    },
    {
      number: '03',
      title: 'Build Widgets',
      description: 'Drag fields onto shelves to create visualizations',
      icon: FiGrid,
    },
    {
      number: '04',
      title: 'Share & Publish',
      description: 'Publish your dashboard and share with your team',
      icon: FiShare2,
    },
  ];

  return (
    <div className="getting-started">
      {/* Hero Section */}
      <div className="gs-hero">
        <div className="gs-hero-content">
          <div className="gs-hero-badge">
            <HiSparkles /> Powered by Snowflake
          </div>
          <h1 className="gs-title">
            Start Building Your Dashboard
          </h1>
          <p className="gs-subtitle">
            Create beautiful, interactive dashboards powered by Snowflake Semantic Views 
            and Cortex AI. No SQL required.
          </p>
          <div className="gs-hero-actions">
            <button 
              className="gs-primary-btn"
              onClick={onSignIn}
            >
              <FiPlay /> Sign In to Get Started
            </button>
            <button className="gs-secondary-btn">
              <FiBook /> Documentation
            </button>
          </div>
        </div>
        <div className="gs-hero-visual">
          <div className="gs-chart-preview">
            <div className="gs-mock-chart">
              <div className="gs-mock-bar" style={{ height: '60%' }}></div>
              <div className="gs-mock-bar" style={{ height: '85%' }}></div>
              <div className="gs-mock-bar" style={{ height: '45%' }}></div>
              <div className="gs-mock-bar" style={{ height: '70%' }}></div>
              <div className="gs-mock-bar" style={{ height: '90%' }}></div>
              <div className="gs-mock-bar" style={{ height: '55%' }}></div>
            </div>
          </div>
        </div>
      </div>

      {/* Features Grid */}
      <div className="gs-section">
        <h2 className="gs-section-title">Why Choose Simply?</h2>
        <div className="gs-features-grid">
          {features.map((feature, idx) => (
            <div key={idx} className="gs-feature-card">
              <div className="gs-feature-icon" style={{ background: `${feature.color}20`, color: feature.color }}>
                <feature.icon />
              </div>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Chart Types */}
      <div className="gs-section gs-charts-section">
        <h2 className="gs-section-title">20+ Chart Types</h2>
        <p className="gs-section-subtitle">
          From simple bar charts to complex Sankey diagrams and box plots
        </p>
        <div className="gs-chart-types">
          {chartTypes.map((chart, idx) => (
            <div key={idx} className="gs-chart-type">
              <chart.icon />
              <span>{chart.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* How It Works */}
      <div className="gs-section">
        <h2 className="gs-section-title">How It Works</h2>
        <div className="gs-steps">
          {steps.map((step, idx) => (
            <div key={idx} className="gs-step">
              <div className="gs-step-number">{step.number}</div>
              <div className="gs-step-icon">
                <step.icon />
              </div>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
              {idx < steps.length - 1 && (
                <div className="gs-step-connector">
                  <FiArrowRight />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* CTA Section */}
      <div className="gs-cta-section">
        <div className="gs-cta-content">
          <h2>Ready to Get Started?</h2>
          <p>Create your first dashboard in minutes, not hours.</p>
          <button 
            className="gs-cta-btn"
            onClick={onSignIn}
          >
            <FiZap /> Sign In Now
          </button>
        </div>
      </div>

      {/* Cortex AI Highlight */}
      <div className="gs-section gs-ai-section">
        <div className="gs-ai-content">
          <div className="gs-ai-badge">
            <HiSparkles /> Snowflake Cortex AI
          </div>
          <h2>AI-Powered Insights</h2>
          <p>
            Create calculated fields using Snowflake Cortex AI functions. 
            Analyze sentiment, summarize text, translate content, and more – 
            all without leaving your dashboard.
          </p>
          <div className="gs-ai-functions">
            <div className="gs-ai-func">
              <FiCode />
              <span>SENTIMENT</span>
            </div>
            <div className="gs-ai-func">
              <FiCode />
              <span>SUMMARIZE</span>
            </div>
            <div className="gs-ai-func">
              <FiCode />
              <span>TRANSLATE</span>
            </div>
            <div className="gs-ai-func">
              <FiCode />
              <span>COMPLETE</span>
            </div>
          </div>
        </div>
        <div className="gs-ai-visual">
          <div className="gs-code-preview">
            <div className="gs-code-header">
              <span className="gs-code-dot red"></span>
              <span className="gs-code-dot yellow"></span>
              <span className="gs-code-dot green"></span>
              <span className="gs-code-title">calculated_field.sql</span>
            </div>
            <pre className="gs-code-content">
{`SNOWFLAKE.CORTEX.SENTIMENT(
  "CUSTOMER_REVIEW"
) AS REVIEW_SENTIMENT`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GettingStarted;
