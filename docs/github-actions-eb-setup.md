# GitHub Actions — Elastic Beanstalk Setup

One-time configuration for CI and production deploy workflows. Application secrets stay on EB; GitHub only needs deploy credentials.

---

## AWS metadata (confirm in console)

| Field | Expected value | How to verify |
|-------|----------------|---------------|
| **Region** | `us-east-1` | EB console region selector |
| **EB application name** | `mosaic-backend` | EB → Applications (inferred from hostname `mosaic-backend.us-east-1.elasticbeanstalk.com`) |
| **EB environment name** | `Mosaic-backend` | EB → Environments — **confirm exact casing** |
| **Platform** | Node.js 18+ on Amazon Linux | Environment → Configuration → Platform |
| **Health check path** | `/` | Configuration → Load balancer |
| **Canonical API** | `https://api.mosaicbizhub.com` | Custom domain on environment |

Record before first deploy:

- Current application version label on EB (rollback baseline)
- Deployed commit SHA if known (from last manual ZIP)

---

## GitHub repository configuration

Repository: `DeveloperTWH/backend`

### Secrets (Settings → Secrets and variables → Actions → Secrets)

**Option A — Access keys (MVP):**

| Secret | Description |
|--------|-------------|
| `AWS_ACCESS_KEY_ID` | IAM user access key with EB deploy permissions |
| `AWS_SECRET_ACCESS_KEY` | Matching secret key |

**Option B — OIDC (recommended long-term):**

| Secret | Description |
|--------|-------------|
| `AWS_ROLE_ARN` | IAM role ARN trusted by GitHub OIDC |

When using OIDC, omit access-key secrets and configure the deploy workflow to assume the role (see IAM section below).

### Variables (Settings → Secrets and variables → Actions → Variables)

| Variable | Value |
|----------|-------|
| `AWS_REGION` | `us-east-1` |
| `EB_APPLICATION_NAME` | `mosaic-backend` (adjust if console differs) |
| `EB_ENVIRONMENT_NAME` | `Mosaic-backend` (adjust if console differs) |

Set via CLI:

```bash
gh variable set AWS_REGION --body "us-east-1" -R DeveloperTWH/backend
gh variable set EB_APPLICATION_NAME --body "mosaic-backend" -R DeveloperTWH/backend
gh variable set EB_ENVIRONMENT_NAME --body "Mosaic-backend" -R DeveloperTWH/backend
```

### Production environment (optional but recommended)

Create environment **`production`** with:

- **Deployment branches:** `main` only
- **Required reviewers:** release owner + infra owner

```bash
gh api -X PUT repos/DeveloperTWH/backend/environments/production \
  -f wait_timer=0 \
  -f reviewers='[]' \
  -f deployment_branch_policy='{"protected_branches":false,"custom_branch_policies":true}' \
  -f custom_branch_policies='[{"name":"main","type":"branch"}]'
```

Add reviewers in the GitHub UI: Settings → Environments → production → Required reviewers.

---

## IAM policy (deploy user or role)

Minimum permissions for `einaregilsson/beanstalk-deploy`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "elasticbeanstalk:CreateApplicationVersion",
        "elasticbeanstalk:UpdateEnvironment",
        "elasticbeanstalk:DescribeApplications",
        "elasticbeanstalk:DescribeEnvironments",
        "elasticbeanstalk:DescribeEvents",
        "elasticbeanstalk:DescribeApplicationVersions"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::elasticbeanstalk-*",
        "arn:aws:s3:::elasticbeanstalk-*/*"
      ]
    },
    {
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

### OIDC trust policy (GitHub → AWS)

Replace `ACCOUNT_ID` and restrict `sub` to this repo:

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
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:DeveloperTWH/backend:*"
        }
      }
    }
  ]
}
```

---

## First deploy checklist

1. [ ] EB application/environment names verified in AWS console
2. [ ] GitHub secrets and variables configured
3. [ ] `production` environment reviewers added (if using approval gate)
4. [ ] Record current EB version as rollback baseline
5. [ ] Run **Deploy to Elastic Beanstalk** workflow via **workflow_dispatch** on `main`
6. [ ] Confirm workflow health probe: `GET https://api.mosaicbizhub.com/` → 200
7. [ ] Run [production-smoke-checklist.md](production-smoke-checklist.md) minimum tier
8. [ ] Update [deploy-verification.md](deploy-verification.md) with deployed SHA

After first successful manual deploy, push-to-`main` auto-deploy is enabled in the workflow (gated by `production` environment when configured).

---

## Rollback

1. GitHub Actions → **Deploy to Elastic Beanstalk** → **Run workflow** → select previous known-good commit on `main`
2. Or AWS Console → EB → Application versions → Deploy previous version
3. Re-run minimum smoke (P0.1, P1.4)
