import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import GithubFeedbackModal from './githubfeedbackmodal';

// The component destructures { submitForm, isSubmitting } from useFormSubmission.
const mockUseFormSubmission = vi.fn();
vi.mock('@/hooks/useAsyncOperation', () => ({
  useFormSubmission: (...args: unknown[]) => mockUseFormSubmission(...args)
}));

vi.mock('@/app/contexts/compat-hooks', () => ({
  useSiteContext: () => null,
  usePlotContext: () => null,
  useOrgCensusContext: () => null
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/'
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' })
}));

vi.mock('@/app/actions/github', () => ({
  createGitHubIssue: vi.fn()
}));

const DIALOG_TITLE_ID = 'github-feedback-title';
const DIALOG_DESCRIPTION_ID = 'github-feedback-description';
const ACCESSIBLE_NAME = 'GitHub Feedback Form';

describe('GithubFeedbackModal - Accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseFormSubmission.mockReturnValue({ submitForm: vi.fn(), isSubmitting: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('MUST expose an accessible name and description on the dialog', () => {
    render(<GithubFeedbackModal open onClose={() => {}} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby', DIALOG_TITLE_ID);
    expect(dialog).toHaveAttribute('aria-describedby', DIALOG_DESCRIPTION_ID);

    expect(document.getElementById(DIALOG_TITLE_ID)).toHaveTextContent(ACCESSIBLE_NAME);
    expect(document.getElementById(DIALOG_DESCRIPTION_ID)).toBeInTheDocument();
    expect(document.getElementById(DIALOG_DESCRIPTION_ID)).toHaveTextContent(/report a bug or request a feature/i);
  });

  it('MUST resolve the accessible name on the dialog element', () => {
    render(<GithubFeedbackModal open onClose={() => {}} />);

    expect(screen.getByRole('dialog')).toHaveAccessibleName(ACCESSIBLE_NAME);
  });

  it('MUST render the title and description ids exactly once in the input state', () => {
    render(<GithubFeedbackModal open onClose={() => {}} />);

    expect(document.querySelectorAll(`#${DIALOG_TITLE_ID}`)).toHaveLength(1);
    expect(document.querySelectorAll(`#${DIALOG_DESCRIPTION_ID}`)).toHaveLength(1);
  });

  it('MUST keep the title and description present and unique in the submitting state', () => {
    mockUseFormSubmission.mockReturnValue({ submitForm: vi.fn(), isSubmitting: true });

    render(<GithubFeedbackModal open onClose={() => {}} />);

    expect(document.querySelectorAll(`#${DIALOG_TITLE_ID}`)).toHaveLength(1);
    expect(document.querySelectorAll(`#${DIALOG_DESCRIPTION_ID}`)).toHaveLength(1);
    expect(document.getElementById(DIALOG_TITLE_ID)).toHaveTextContent(ACCESSIBLE_NAME);
  });
});
