import React from 'react';
import './SplashScreen.css';

const SplashScreen: React.FC = () => {
  return (
    <div className="splash-screen">
      <div className="splash-content">
        <h1 className="splash-title">
          <span>G</span>
          <span>o</span>
          <span>n</span>
          <span>g</span>
          <span>d</span>
          <span>o</span>
        </h1>
        <div className="loading-bar"></div>
      </div>
    </div>
  );
};

export default SplashScreen;