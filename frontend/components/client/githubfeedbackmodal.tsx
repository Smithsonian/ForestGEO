"use client";

import { Box, Button, Card, CardContent, Chip, DialogActions, DialogContent, DialogTitle, Divider, FormControl, FormLabel, Grid, IconButton, Input, LinearProgress, List, ListItem, Modal, ModalClose, ModalDialog, ModalOverflow, Radio, RadioGroup, Stack, Textarea, Tooltip, Typography } from "@mui/joy";
import { useState } from "react";
import { BugReport, Error as ErrorIcon, Info, Build, AccessibilityNew, GitHub, Event, Person } from '@mui/icons-material';
import { Octokit } from "octokit";
import { useOrgCensusContext, usePlotContext, useSiteContext } from "@/app/contexts/userselectionprovider";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// this has been shelved -- it's a little too complicated for a first iteration.
// saving it for a later version.
const issueTypes = [
  {
    value: "data-issue",
    label: "Data Issue",
    icon: <BugReport />,
    tooltip: "Problems with missing information, incorrect data, or file upload issues."
  },
  {
    value: "ui-issue",
    label: "UI/UX Issue",
    icon: <ErrorIcon />,
    tooltip: "Problems with buttons, pop-ups, navigation, or how the site looks and feels."
  },
  {
    value: "functional-issue",
    label: "Functional Issue",
    icon: <Build />,
    tooltip: "Issues with features not working, broken links, or buttons that don't respond."
  },
  {
    value: "accessibility-issue",
    label: "Accessibility Issue",
    icon: <AccessibilityNew />,
    tooltip: "Problems with accessing or using the site, especially for users with disabilities."
  },
  { value: "other", label: "Other Issue", icon: <Info />, tooltip: "Any other feedback or issues not listed above." },
];

type IssueType = typeof issueTypes[number]["value"];

type GithubFeedbackModalProps = {
  open: boolean;
  onClose: () => void;
};

type Issue = {
  [key: string]: any;
}

const tempResults = {
  "url": "https://api.github.com/repos/Smithsonian/ForestGEO/issues",
  "status": 201,
  "headers": {
    "cache-control": "private, max-age=60, s-maxage=60",
    "content-length": "5269",
    "content-type": "application/json; charset=utf-8",
    "etag": "\"8960e8c7d92cf6831c42b3fb84ec6abeb7c632c9aad3a80d652a66ef4726cbda\"",
    "location": "https://api.github.com/repos/Smithsonian/ForestGEO/issues/174",
    "x-github-media-type": "github.v3; format=json",
    "x-github-request-id": "CDC2:167501:10ACA8:1F233D:66A138FA",
    "x-ratelimit-limit": "5000",
    "x-ratelimit-remaining": "4992",
    "x-ratelimit-reset": "1721843759",
    "x-ratelimit-resource": "core",
    "x-ratelimit-used": "8"
  },
  "data": {
    "url": "https://api.github.com/repos/Smithsonian/ForestGEO/issues/174",
    "repository_url": "https://api.github.com/repos/Smithsonian/ForestGEO",
    "labels_url": "https://api.github.com/repos/Smithsonian/ForestGEO/issues/174/labels{/name}",
    "comments_url": "https://api.github.com/repos/Smithsonian/ForestGEO/issues/174/comments",
    "events_url": "https://api.github.com/repos/Smithsonian/ForestGEO/issues/174/events",
    "html_url": "https://github.com/Smithsonian/ForestGEO/issues/174",
    "id": 2428111161,
    "node_id": "I_kwDOFKOFws6Qugk5",
    "number": 174,
    "title": "APP-USER-GENERATED: Feedback Ticket Created for Issue Type: data-issue",
    "user": {
      "login": "siddheshraze",
      "id": 81591724,
      "node_id": "MDQ6VXNlcjgxNTkxNzI0",
      "avatar_url": "https://avatars.githubusercontent.com/u/81591724?v=4",
      "gravatar_id": "",
      "url": "https://api.github.com/users/siddheshraze",
      "html_url": "https://github.com/siddheshraze",
      "followers_url": "https://api.github.com/users/siddheshraze/followers",
      "following_url": "https://api.github.com/users/siddheshraze/following{/other_user}",
      "gists_url": "https://api.github.com/users/siddheshraze/gists{/gist_id}",
      "starred_url": "https://api.github.com/users/siddheshraze/starred{/owner}{/repo}",
      "subscriptions_url": "https://api.github.com/users/siddheshraze/subscriptions",
      "organizations_url": "https://api.github.com/users/siddheshraze/orgs",
      "repos_url": "https://api.github.com/users/siddheshraze/repos",
      "events_url": "https://api.github.com/users/siddheshraze/events{/privacy}",
      "received_events_url": "https://api.github.com/users/siddheshraze/received_events",
      "type": "User",
      "site_admin": false
    },
    "labels": [
      {
        "id": 7221676365,
        "node_id": "LA_kwDOFKOFws8AAAABrnIJTQ",
        "url": "https://api.github.com/repos/Smithsonian/ForestGEO/labels/useridentifiedbug",
        "name": "useridentifiedbug",
        "color": "9758DC",
        "default": false,
        "description": "website user used online form to submit issue, tagged with this"
      }
    ],
    "state": "open",
    "locked": false,
    "assignee": {
      "login": "siddheshraze",
      "id": 81591724,
      "node_id": "MDQ6VXNlcjgxNTkxNzI0",
      "avatar_url": "https://avatars.githubusercontent.com/u/81591724?v=4",
      "gravatar_id": "",
      "url": "https://api.github.com/users/siddheshraze",
      "html_url": "https://github.com/siddheshraze",
      "followers_url": "https://api.github.com/users/siddheshraze/followers",
      "following_url": "https://api.github.com/users/siddheshraze/following{/other_user}",
      "gists_url": "https://api.github.com/users/siddheshraze/gists{/gist_id}",
      "starred_url": "https://api.github.com/users/siddheshraze/starred{/owner}{/repo}",
      "subscriptions_url": "https://api.github.com/users/siddheshraze/subscriptions",
      "organizations_url": "https://api.github.com/users/siddheshraze/orgs",
      "repos_url": "https://api.github.com/users/siddheshraze/repos",
      "events_url": "https://api.github.com/users/siddheshraze/events{/privacy}",
      "received_events_url": "https://api.github.com/users/siddheshraze/received_events",
      "type": "User",
      "site_admin": false
    },
    "assignees": [
      {
        "login": "siddheshraze",
        "id": 81591724,
        "node_id": "MDQ6VXNlcjgxNTkxNzI0",
        "avatar_url": "https://avatars.githubusercontent.com/u/81591724?v=4",
        "gravatar_id": "",
        "url": "https://api.github.com/users/siddheshraze",
        "html_url": "https://github.com/siddheshraze",
        "followers_url": "https://api.github.com/users/siddheshraze/followers",
        "following_url": "https://api.github.com/users/siddheshraze/following{/other_user}",
        "gists_url": "https://api.github.com/users/siddheshraze/gists{/gist_id}",
        "starred_url": "https://api.github.com/users/siddheshraze/starred{/owner}{/repo}",
        "subscriptions_url": "https://api.github.com/users/siddheshraze/subscriptions",
        "organizations_url": "https://api.github.com/users/siddheshraze/orgs",
        "repos_url": "https://api.github.com/users/siddheshraze/repos",
        "events_url": "https://api.github.com/users/siddheshraze/events{/privacy}",
        "received_events_url": "https://api.github.com/users/siddheshraze/received_events",
        "type": "User",
        "site_admin": false
      }
    ],
    "milestone": null,
    "comments": 0,
    "created_at": "2024-07-24T17:25:14Z",
    "updated_at": "2024-07-24T17:25:14Z",
    "closed_at": null,
    "author_association": "MEMBER",
    "active_lock_reason": null,
    "body": "\n### Description\ntest\n\n### Pathname\n/dashboard\n\n### User Details\n- **Name**: test\n- **Issue Type**: data-issue\n\n### Site Details\n- **Site**: Not selected\n- **Schema**: Not selected\n- **Plot**: Not selected\n- **Location**: Not selected\n- **Census**: Not selected\n",
    "closed_by": null,
    "reactions": {
      "url": "https://api.github.com/repos/Smithsonian/ForestGEO/issues/174/reactions",
      "total_count": 0,
      "+1": 0,
      "-1": 0,
      "laugh": 0,
      "hooray": 0,
      "confused": 0,
      "heart": 0,
      "rocket": 0,
      "eyes": 0
    },
    "timeline_url": "https://api.github.com/repos/Smithsonian/ForestGEO/issues/174/timeline",
    "performed_via_github_app": null,
    "state_reason": null
  }
}

const formatHeaders = (headers: any) => {
  const importantHeaders = ['content-type', 'etag', 'x-github-request-id'];
  return importantHeaders.map((key) => (
    // <Typography key={key} level={"body-md"}>
    //   <strong>{key}:</strong> {headers[key]}
    // </Typography>
    <Tooltip title={key}>
      <Chip color="neutral">{headers[key]}</Chip>
    </Tooltip>
  ));
};

export default function GithubFeedbackModal({ open, onClose }: GithubFeedbackModalProps) {

  const [name, setName] = useState<string>("");
  const [issueType, setIssueType] = useState<IssueType | null>(null);
  const [description, setDescription] = useState("");
  const [createdIssue, setCreatedIssue] = useState<Issue | null>(null);
  const [loading, setLoading] = useState(false);
  const [isBodyTooltipHovered, setIsBodyTooltipHovered] = useState(false);
  const pat = process.env.FG_PAT;
  const owner = process.env.OWNER;
  const repo = process.env.REPO;
  if (!pat || !owner || !repo) return <>ENV FAILURE</>;

  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const pathname = usePathname();
  const { data: session } = useSession();

  const handleMouseEnter = () => {
    setIsBodyTooltipHovered(true);
  };

  const handleMouseLeave = () => {
    setIsBodyTooltipHovered(false);
  };

  async function handleSubmitIssue() {
    setLoading(true);
    const octokit = new Octokit({
      auth: pat
    });
    const issueBody = `
### Description
${description}  


### Pathname
${pathname}  


### User Details
- **Provided Name**: ${name}  


### Session Details
- **Name**: ${session?.user?.name}
- **Email**: ${session?.user?.email}
- **Assigned Sites**: ${session?.user?.sites?.toString()}  


### Site Details
- **Site**: ${currentSite ? currentSite.siteName : "Not selected"}
- **Schema**: ${currentSite ? currentSite.schemaName : "Not selected"}
- **Plot**: ${currentPlot ? currentPlot.plotName : "Not selected"}
- **Location**: ${currentPlot ? currentPlot.locationName : "Not selected"}
- **Census**: ${currentCensus ? currentCensus.plotCensusNumber : "Not selected"}  
`;
    // handle the issue submission logic here
    const results = await octokit.request(`POST /repos/${owner}/${repo}/issues`, {
      owner: owner,
      repo: repo,
      title: `APP-USER-GENERATED: Feedback Ticket Created for Issue Type: ${issueType}`,
      body: issueBody,
      labels: [
        'useridentifiedbug'
      ],
      assignees: [
        'siddheshraze'
      ],
      headers: {
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    if (results.status !== 201) throw new Error("Failed to create GitHub issue: ", results);
    setCreatedIssue(results.data);
    // await new Promise(resolve => setTimeout(resolve, 1000));
    // setCreatedIssue(tempResults);
    setLoading(false);
  }

  function handleCancel() {
    setName('');
    setIssueType(null);
    setDescription('');
    setCreatedIssue(null);
    setLoading(false);
    onClose();
  }

  return (
    <Modal open={open} sx={{ display: "flex", flex: 1, flexDirection: "row" }}>
      <ModalOverflow>
        <ModalDialog role="alertdialog">
          <ModalClose variant="outlined" onClick={handleCancel} />
          {!createdIssue && !loading && (
            <>
              <DialogTitle>
                GitHub Feedback Form
              </DialogTitle>
              <DialogContent sx={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
                <Divider orientation="horizontal" sx={{ my: 1 }} />
                <Grid container spacing={1}>
                  <Grid xs={4}>
                    {currentSite ? (
                      <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
                        <Typography level="body-sm" fontWeight={'xl'}>Selected Site: {currentSite.siteName}</Typography>
                        <Typography level="body-xs">&mdash;Schema: {currentSite.schemaName}</Typography>
                      </Box>
                    ) : (
                      <Typography level="body-sm">No site selected.</Typography>
                    )}
                  </Grid>
                  <Grid xs={4}>
                    {currentPlot ? (
                      <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
                        <Typography level="body-sm">Selected Plot: {currentPlot.plotName}</Typography>
                        <Typography level="body-xs">&mdash;Location: {currentPlot.locationName}</Typography>
                      </Box>
                    ) : (
                      <Typography level="body-sm">No plot selected.</Typography>
                    )}
                  </Grid>
                  <Grid xs={4}>
                    {currentCensus ? (
                      <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
                        <Typography level="body-sm">Selected Census: {currentCensus.plotCensusNumber}</Typography>
                      </Box>
                    ) : (
                      <Typography level="body-sm">No census selected.</Typography>
                    )}
                  </Grid>
                </Grid>
                <Divider orientation="horizontal" sx={{ mb: 2, mt: 1 }} />
                <FormControl>
                  <FormLabel>
                    <Typography level="title-md">Name:</Typography>
                  </FormLabel>
                  <Input
                    placeholder="Person Doe..."
                    onChange={(event) => setName(event.target.value)}
                    sx={{
                      "&::before": {
                        border: "1.5px solid var(--Input-focusedHighlight)",
                        transform: "scaleX(0)",
                        left: "2.5px",
                        right: "2.5px",
                        bottom: 0,
                        top: "unset",
                        transition: "transform .15s cubic-bezier(0.1,0.9,0.2,1)",
                        borderRadius: 0,
                        borderBottomLeftRadius: "64px 20px",
                        borderBottomRightRadius: "64px 20px",
                      },
                      "&:focus-within::before": {
                        transform: "scaleX(1)",
                      },
                      marginBottom: 2,
                    }}
                  />
                </FormControl>
                <FormControl>
                  <Typography level="title-sm" mt={2} mb={1}>
                    What kind of issue was it?
                  </Typography>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <RadioGroup
                      orientation="horizontal"
                      aria-labelledby="issue-type-selection"
                      name="issue-type"
                      value={issueType}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        setIssueType(event.target.value as IssueType)
                      }
                      sx={{
                        minHeight: 48,
                        padding: "4px",
                        borderRadius: "12px",
                        bgcolor: "neutral.softBg",
                        "--RadioGroup-gap": "4px",
                        "--Radio-actionRadius": "8px",
                      }}
                    >
                      {issueTypes.map((issue) => (
                        <Tooltip key={issue.value} title={issue.tooltip} color="primary" placement="top">
                          <Radio
                            color="neutral"
                            value={issue.value}
                            disableIcon
                            label={issue.label}
                            variant="plain"
                            sx={{
                              px: 2,
                              alignItems: "center",
                            }}
                            slotProps={{
                              action: ({ checked }) => ({
                                sx: {
                                  ...(checked && {
                                    bgcolor: "background.surface",
                                    boxShadow: "sm",
                                    "&:hover": {
                                      bgcolor: "background.surface",
                                    },
                                  }),
                                },
                              }),
                            }}
                          />
                        </Tooltip>
                      ))}
                    </RadioGroup>
                  </Box>
                </FormControl>
                <FormControl>
                  <Typography level="title-sm" mt={2} mb={1}>
                    Can you describe the issue in more detail?
                  </Typography>
                  <Textarea
                    variant="outlined"
                    required
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="This component wasn't working..."
                    sx={{
                      "--Textarea-focusedInset": "var(--any, )",
                      "--Textarea-focusedThickness": "0.15rem",
                      "--Textarea-focusedHighlight": "rgba(13,110,253,.25)",
                      "&::before": {
                        transition: "box-shadow .15s ease-in-out",
                      },
                      "&:focus-within": {
                        borderColor: "#86b7fe",
                      },
                      width: "100%",
                    }}
                  />
                </FormControl>
              </DialogContent>
              <DialogActions>
                <Stack direction="row" justifyContent="flex-end" spacing={1} mt={2}>
                  <Button variant="plain" onClick={() => handleCancel()}>
                    Cancel
                  </Button>
                  <Button variant="solid" disabled={name === '' || issueType === null || description === ''}
                    onClick={handleSubmitIssue}>
                    Confirm
                  </Button>
                </Stack>
              </DialogActions>
            </>
          )}
          {!createdIssue && loading && (
            <>
              <DialogTitle sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
                Submitting issue...
              </DialogTitle>
              <DialogContent>
                <LinearProgress variant="soft" />
              </DialogContent>
            </>
          )}
          {createdIssue && (
            <>
              <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Stack direction={"row"} justifyContent={"flex-start"} alignItems={'center'}>
                  <GitHub sx={{ fontSize: '2rem' }} />
                  <Typography level="h1" sx={{ ml: 1 }}>Issue Created!</Typography>
                </Stack>
              </DialogTitle>
              <DialogContent>
                <Divider sx={{ my: '10px' }} />
                <Stack direction={'row'} divider={<Divider orientation="vertical" />} sx={{ justifyContent: 'space-evenly', alignItems: 'center' }}>
                  <Card variant="plain" size="sm">
                    <CardContent sx={{ flexDirection: 'row' }}>
                      <Tooltip title="Submission Status">
                        <Chip color="success" variant="outlined">
                          {createdIssue.status}
                        </Chip>
                      </Tooltip>
                    </CardContent>
                  </Card>
                  <Card variant="plain" size="sm">
                    <CardContent sx={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
                      <Tooltip title="Click here to see your new issue!">
                        <Chip variant="soft" color={"primary"} slotProps={{ action: { component: 'a', href: createdIssue.headers['location'].replace('api.github.com/repos', 'github.com'), target: "_blank", rel: "noopener noreferrer" } }}>
                          {createdIssue.headers['location'].replace('api.github.com/repos', 'github.com')}
                        </Chip>
                      </Tooltip>
                    </CardContent>
                  </Card>
                </Stack>
                <Divider sx={{ my: '10px' }} />
                <Card variant="plain">
                  <CardContent>
                    <Typography level="title-lg" sx={{ marginBottom: 1 }}>Headers</Typography>
                    <Stack spacing={1}>
                      {formatHeaders(createdIssue.headers)}
                    </Stack>
                  </CardContent>
                </Card>
                <Divider sx={{ my: '10px' }} />
                <Card variant="plain">
                  <CardContent>
                    <Box>
                      <Typography level="title-lg" sx={{ marginBottom: 1 }}>Issue Details</Typography>
                      <Stack direction={'row'} spacing={1}>
                        <Typography level="body-md" fontWeight={'bold'}>Title: </Typography>
                        <Chip color="primary" variant="outlined">{createdIssue.data.title}</Chip>
                      </Stack>
                    </Box>
                    <Tooltip title="Submitted Issue Description" placement="left" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
                      <Card variant="soft" sx={{ my: 1 }}>
                        <CardContent>
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              h1: ({ children }) => <Typography component="h1" level="title-lg">{children}</Typography>,
                              h2: ({ children }) => <Typography component="h2" level="title-lg">{children}</Typography>,
                              h3: ({ children }) => <Typography component="h3" level="title-lg">{children}</Typography>,
                              h4: ({ children }) => <Typography component="h4" level="title-lg">{children}</Typography>,
                              h5: ({ children }) => <Typography component="h5" level="title-lg">{children}</Typography>,
                              h6: ({ children }) => <Typography component="h6" level="title-lg">{children}</Typography>,
                              p: ({ children }) => <Typography component="p" level="body-sm">{children}</Typography>,
                              ul: ({ children }) => <List marker='disc'>{children}</List>,
                              li: ({ children }) => (
                                <ListItem>
                                  <Typography component="span" level="body-sm">{children}</Typography>
                                </ListItem>
                              ),
                              strong: ({ children }) => <Typography component="strong" level="body-md" fontWeight="bold">{children}</Typography>,
                            }}
                          >
                            {createdIssue.data.body}
                          </ReactMarkdown>
                        </CardContent>
                      </Card>
                    </Tooltip>
                    <Typography level="body-md" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Event />
                      <span><strong>Created At:</strong> {new Date(createdIssue.data.created_at).toLocaleString()}</span>
                    </Typography>
                    <Typography level="body-md" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Person />
                      <span><strong>Created By:</strong> {session?.user.name}</span>
                    </Typography>
                  </CardContent>
                </Card>
              </DialogContent>
              <DialogActions>
                <Stack direction="row" justifyContent="flex-end" spacing={1} mt={2}>
                  <Button variant="plain" onClick={handleCancel}>
                    Complete
                  </Button>
                </Stack>
              </DialogActions>
            </>
          )}
        </ModalDialog>
      </ModalOverflow>
    </Modal >
  );
}
