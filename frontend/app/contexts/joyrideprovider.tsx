import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import Joyride, { CallBackProps, STATUS, Step, StoreHelpers } from 'react-joyride';

interface JoyrideContextType {
  runTutorial: boolean;
  setRunTutorial: React.Dispatch<React.SetStateAction<boolean>>;
  startTutorial: () => void;
  stopTutorial: () => void;
  tutorialCompleted: boolean;
}

const JoyrideContext = createContext<JoyrideContextType | undefined>(undefined);

export const useJoyride = () => {
  const context = useContext(JoyrideContext);
  if (!context) {
    throw new Error('useJoyride must be used within a JoyrideProvider');
  }
  return context;
};

export const JoyrideProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [runTutorial, setRunTutorial] = useState(false);
  const [tutorialCompleted, setTutorialCompleted] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [isMounted, setIsMounted] = useState(false);
  const joyrideRef = useRef<StoreHelpers | null>(null);

  useEffect(() => {
    setIsMounted(true);
    updateSteps();
  }, []);

  useEffect(() => {
    if (runTutorial) {
      updateSteps();
    }
  }, [runTutorial]);

  const updateSteps = () => {
    const newSteps: Step[] = [];
    const stepElements = [
      { selector: '.site-selection-1', content: 'Select a site to get started.', disableBeacon: true },
      { selector: '.site-selection-modal-2', content: 'Select a site to begin.', disableBeacon: true },
      { selector: '.site-deselect-option-3', content: 'Deselect site to reset.', disableBeacon: true },
      { selector: '.site-allowed-site-list-4', content: 'Allowed sites list.', disableBeacon: true },
      { selector: '.site-not-allowed-site-list-5', content: 'Other sites list.', disableBeacon: true },
      { selector: '.plot-selection-6', content: 'Select a plot to view details.', disableBeacon: true },
      { selector: '.plot-selection-modal-7', content: 'Select a plot.', disableBeacon: true },
      { selector: '.plot-selection-select-8', content: 'Choose a plot from the dropdown.', disableBeacon: true },
      { selector: '.plot-create-9', content: 'Add a new plot.', disableBeacon: true },
      { selector: '.plot-edit-button-10', content: 'Edit the selected plot.', disableBeacon: true },
      { selector: '.plot-delete-button-11', content: 'Delete the selected plot.', disableBeacon: true },
      { selector: '.census-selection-12', content: 'Select a census to see data.', disableBeacon: true },
      { selector: '.census-selection-modal-13', content: 'Choose a census.', disableBeacon: true },
      { selector: '.census-select-14', content: 'Select a census from the dropdown.', disableBeacon: true },
      { selector: '.census-add-new-15', content: 'Add a new census.', disableBeacon: true },
      { selector: '.census-close-16', content: 'Close the selected census.', disableBeacon: true },
      { selector: '.census-edit-17', content: 'Edit the selected census.', disableBeacon: true },
      { selector: '.census-delete-18', content: 'Delete the selected census.', disableBeacon: true },
    ];

    stepElements.forEach(({ selector, content, disableBeacon }) => {
      if (document.querySelector(selector)) {
        newSteps.push({
          target: selector,
          content: content,
          disableBeacon: disableBeacon,
        });
      }
    });

    setSteps(newSteps);
  };

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status, index, action } = data;
    console.log('Joyride status:', status, 'index:', index, 'action:', action); // Debugging log

    const finishedStatuses: string[] = [STATUS.FINISHED, STATUS.SKIPPED];

    if (finishedStatuses.includes(status)) {
      setRunTutorial(false);
      setTutorialCompleted(true);
    } else if (status === STATUS.RUNNING && action === 'update' && joyrideRef.current) {
      const currentStep = steps[index];
      if (currentStep && typeof currentStep.target === 'string' && !document.querySelector(currentStep.target)) {
        joyrideRef.current.reset(true);
      }
    }
  };

  const startTutorial = () => {
    if (!tutorialCompleted) {
      setRunTutorial(true);
    }
  };

  const stopTutorial = () => {
    setRunTutorial(false);
  };

  return (
    <JoyrideContext.Provider
      value={{ runTutorial, setRunTutorial, startTutorial, stopTutorial, tutorialCompleted }}
    >
      {children}
      {isMounted && (
        <Joyride
          ref={(instance) => {
            if (instance) {
              joyrideRef.current = instance as unknown as StoreHelpers;
            }
          }}
          steps={steps}
          run={runTutorial}
          continuous
          scrollToFirstStep
          showProgress
          showSkipButton
          callback={handleJoyrideCallback}
          styles={{
            options: {
              arrowColor: '#eee',
              backgroundColor: '#333',
              overlayColor: 'rgba(0, 0, 0, 0.5)',
              primaryColor: '#29d',
              textColor: '#fff',
              width: 900,
              zIndex: 1000,
            },
          }}
        />
      )}
    </JoyrideContext.Provider>
  );
};
