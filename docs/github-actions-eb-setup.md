# GitHub Actions — Elastic Beanstalk Setup

One-time configuration for CI and production deploy workflows. Deploy auth uses **GitHub OIDC → IAM role assumption** (no long-lived AWS access keys in GitHub). Application runtime secrets stay on EB; GitHub only needs deploy role + EB metadata variables.

---

## AWS metadata (confirmed in console)

| Field | Value | How to verify |
|-------|-------|---------------|
| **Region** | `us-east-1` | EB console region selector |
| **EB application name** | `mosaic-biz-hub-backend` | EB → Applications |
| **EB environment name** | `mosaic-backend-env` | EB → Environments |
| **EB domain** | `mosaic-backend.us-east-1.elasticbeanstalk.com` | Environment overview |
| **Platform** | Node.js 22 running on 64bit Amazon Linux 2023/6.6.1 | Configuration → Platform |
| **Health check path** | `/` | Configuration → Load balancer |
| **Canonical API** | `https://api.mosaicbizhub.com` | Custom domain on environment |

Record before first deploy:

- Current application version label on EB (rollback baseline)
- Deployed commit SHA if known (from last manual ZIP)

---

## GitHub repository configuration

Repository: `DeveloperTWH/backend`

### Variables (Settings → Secrets and variables → Actions → Variables)

| Variable | Value |
|----------|-------|
| `AWS_REGION` | `us-east-1` |
| `EB_APPLICATION_NAME` | `mosaic-biz-hub-backend` |
| `EB_ENVIRONMENT_NAME` | `mosaic-backend-env` |
| `AWS_ROLE_TO_ASSUME` | IAM role ARN (see IAM section below) |

Set via CLI (replace `ACCOUNT_ID` with your 12-digit AWS account ID):

```bash
gh variable set AWS_REGION --body "us-east-1" -R DeveloperTWH/backend
gh variable set EB_APPLICATION_NAME --body "mosaic-biz-hub-backend" -R DeveloperTWH/backend
gh variable set EB_ENVIRONMENT_NAME --body "mosaic-backend-env" -R DeveloperTWH/backend
gh variable set AWS_ROLE_TO_ASSUME --body "arn:aws:iam::ACCOUNT_ID:role/github-actions-eb-deploy-production" -R DeveloperTWH/backend
```

Optional — scope role ARN to the production environment only:

```bash
gh variable set AWS_ROLE_TO_ASSUME --env production --body "arn:aws:iam::ACCOUNT_ID:role/github-actions-eb-deploy-production" -R DeveloperTWH/backend
```

**Do not** add runtime application secrets (`MONGO_URI`, Stripe keys, runtime S3 keys, etc.) to GitHub. Those belong in Elastic Beanstalk environment properties.

### Production environment (recommended)

Create environment **`production`** with:

- **Deployment branches:** `main` only
- **Required reviewers:** release owner + infra owner

```bash
gh api -X PUT repos/DeveloperTWH/backend/environments/production \
  -f wait_timer=0 \
  -f deployment_branch_policy='{"protected_branches":false,"custom_branch_policies":true}' \
  -f custom_branch_policies='[{"name":"main","type":"branch"}]'
```

Add reviewers in the GitHub UI: Settings → Environments → production → Required reviewers.

The deploy workflow job uses `environment: production`, which scopes the OIDC `sub` claim to `repo:DeveloperTWH/backend:environment:production`.

---

## AWS IAM setup (OIDC)

Replace `ACCOUNT_ID` with your 12-digit AWS account ID.

### Step A — GitHub OIDC identity provider (one-time, if not present)

AWS Console → IAM → Identity providers → Add provider:

- **Provider URL:** `https://token.actions.githubusercontent.com`
- **Audience:** `sts.amazonaws.com`

### Step B — IAM role trust policy (environment-scoped)

Role name suggestion: `github-actions-eb-deploy-production`

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:DeveloperTWH/backend:environment:production"
        }
      }
    }
  ]
}
```

Only workflow runs gated by the GitHub **`production`** environment can assume this role.

### Step C — Permissions policy (least privilege)

Attach inline policy `GitHubActionsEBDeployProduction` to the role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ElasticBeanstalkDeploy",
      "Effect": "Allow",
      "Action": [
        "elasticbeanstalk:CreateApplicationVersion",
        "elasticbeanstalk:UpdateEnvironment",
        "elasticbeanstalk:DescribeApplications",
        "elasticbeanstalk:DescribeEnvironments",
        "elasticbeanstalk:DescribeEvents",
        "elasticbeanstalk:DescribeApplicationVersions"
      ],
      "Resource": [
        "arn:aws:elasticbeanstalk:us-east-1:ACCOUNT_ID:application/mosaic-biz-hub-backend",
        "arn:aws:elasticbeanstalk:us-east-1:ACCOUNT_ID:application/mosaic-biz-hub-backend/*",
        "arn:aws:elasticbeanstalk:us-east-1:ACCOUNT_ID:environment/mosaic-biz-hub-backend/mosaic-backend-env"
      ]
    },
    {
      "Sid": "ElasticBeanstalkRegionalBucket",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::elasticbeanstalk-us-east-1-ACCOUNT_ID",
        "arn:aws:s3:::elasticbeanstalk-us-east-1-ACCOUNT_ID/*"
      ]
    },
    {
      "Sid": "DeployWaitDescribe",
      "Effect": "Allow",
      "Action": [
        "autoscaling:DescribeAutoScalingGroups",
        "autoscaling:DescribeAutoScalingInstances",
        "ec2:DescribeInstances",
        "ec2:DescribeImages",
        "cloudformation:DescribeStackResources",
        "cloudformation:DescribeStacks"
      ],
      "Resource": "*"
    }
  ]
}
```

Notes:

- `s3:CreateBucket` is omitted — the regional EB bucket already exists for this application.
- If deploy fails with `AccessDenied` on `iam:PassRole`, add a narrow `iam:PassRole` statement for the EB service/instance roles only (unlikely for version-only deploys to an existing environment).

After creating the role, copy its ARN into the GitHub variable `AWS_ROLE_TO_ASSUME`.

---

## Workflow auth flow

The deploy workflow (`.github/workflows/deploy-eb-production.yml`):

1. Runs tests
2. Builds a source-only ZIP
3. Assumes the IAM role via `aws-actions/configure-aws-credentials@v4` using OIDC (`id-token: write`)
4. Passes temporary credentials to `einaregilsson/beanstalk-deploy@v22`
5. Runs post-deploy health probes on `https://api.mosaicbizhub.com`

Push-to-`main` auto-deploy is **temporarily disabled** in the workflow (only `workflow_dispatch` runs until AWS OIDC and the GitHub `production` environment are confirmed). After first successful manual deploy, re-enable the push trigger in the workflow. When enabled, deploys are gated by the GitHub **`production`** environment.

---

## First deploy checklist

1. [ ] GitHub OIDC identity provider exists in AWS IAM
2. [ ] IAM role created with environment-scoped trust policy and permissions policy above
3. [ ] GitHub variables set (`AWS_REGION`, `EB_*`, `AWS_ROLE_TO_ASSUME`)
4. [ ] `production` environment created with `main`-only deployment policy
5. [ ] Required reviewers added on `production` (recommended)
6. [ ] Record current EB version as rollback baseline
7. [ ] Run **Deploy to Elastic Beanstalk** via **workflow_dispatch** on `main`
8. [ ] Confirm workflow health probe: `GET https://api.mosaicbizhub.com/` → 200
9. [ ] Run [production-smoke-checklist.md](production-smoke-checklist.md) minimum tier
10. [ ] Update [deploy-verification.md](deploy-verification.md) with deployed SHA

After first successful manual deploy, re-enable push-to-`main` in the workflow; auto-deploy will then be gated by the `production` environment when configured.

Remove obsolete deploy secrets if they were ever added (not used by OIDC):

```bash
gh secret delete AWS_ACCESS_KEY_ID -R DeveloperTWH/backend
gh secret delete AWS_SECRET_ACCESS_KEY -R DeveloperTWH/backend
```

---

## First deploy attempt (2026-06-16)

Workflow run on merge of PR #12 (`main` @ `8b098ad`):

| Step | Result |
|------|--------|
| `npm ci` + `npm test` | **PASS** |
| Create deployment ZIP | **PASS** |
| Deploy to EB | **FAIL** — `AWS Access Key not specified!` |

**Resolution:** Migrate deploy auth to OIDC (this document). Infra owner completes IAM + GitHub variable setup, then re-runs **Deploy to Elastic Beanstalk** via Actions → Run workflow on `main`.

---

## Rollback

1. GitHub Actions → **Deploy to Elastic Beanstalk** → **Run workflow** → select previous known-good commit on `main`
2. Or AWS Console → EB → Application versions → Deploy previous version
3. Re-run minimum smoke (P0.1, P1.4)
