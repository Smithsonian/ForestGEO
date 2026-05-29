import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import GithubFeedbackModal from './githubfeedbackmodal';
import { createGitHubIssue } from '@/app/actions/github';

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

  it('MUST keep the title and description present, unique, and the accessible name stable in the success state', async () => {
    const createdIssue = {
      status: 'open',
      html_url: 'https://github.com/example/repo/issues/1',
      title: 'APP-USER-GENERATED: Feedback Ticket: other',
      body: '### Description\nexample',
      created_at: '2026-05-29T00:00:00Z'
    };
    vi.mocked(createGitHubIssue).mockResolvedValue({ success: true, issue: createdIssue });

    // Drive the component into the createdIssue branch by having submitForm run the
    // real submit callback the component passes to useFormSubmission, which awaits
    // createGitHubIssue and calls setCreatedIssue with the resolved issue.
    mockUseFormSubmission.mockImplementation((submitCallback: () => Promise<void>) => ({
      submitForm: () => {
        void submitCallback();
      },
      isSubmitting: false
    }));

    render(<GithubFeedbackModal open onClose={() => {}} />);

    // The Confirm button is disabled until name, issue type, and description are set.
    fireEvent.change(screen.getByLabelText(/input for name of person reporting feedback/i), { target: { value: 'Person Doe' } });
    fireEvent.click(screen.getByRole('radio', { name: /other issue/i }));
    fireEvent.change(screen.getByLabelText(/description box/i), { target: { value: 'example' } });

    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => {
      expect(screen.getByText(/issue created/i)).toBeInTheDocument();
    });

    expect(document.querySelectorAll(`#${DIALOG_TITLE_ID}`)).toHaveLength(1);
    expect(document.querySelectorAll(`#${DIALOG_DESCRIPTION_ID}`)).toHaveLength(1);
    expect(document.getElementById(DIALOG_TITLE_ID)).toHaveTextContent(ACCESSIBLE_NAME);
    expect(screen.getByRole('dialog')).toHaveAccessibleName(ACCESSIBLE_NAME);
  });
});
