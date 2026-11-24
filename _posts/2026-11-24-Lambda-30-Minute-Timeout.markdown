---
layout: post
title: "Lambda's new 30 minute timeout: running 30 million Man United seasons in one function"
date: 2026-11-24 05:30:00 +0000
tags: aws lambda serverless terraform sqs
published: true
canonical_url: https://builder.aws.com/content/3MWWrxWWpuDPN6CfIikBX1eLd8g/lambdas-new-30-minute-timeout-running-30-million-man-united-seasons-in-one-function
---

*This post was originally published on [AWS Builder Center](https://builder.aws.com/content/3MWWrxWWpuDPN6CfIikBX1eLd8g/lambdas-new-30-minute-timeout-running-30-million-man-united-seasons-in-one-function).*

## Preface

Since 2018 the first question I ask before putting anything on Lambda is "will it finish in 15 minutes?".

If not, it went to Fargate or Batch. Half the reason my [S3 to Batch via EventBridge](https://redm0nd.github.io/2024/09/02/S3-EventBridge-Batch.html) post exists is that limit.

On November 19th AWS [raised it to 30 minutes](https://aws.amazon.com/blogs/compute/announcing-30-minute-timeout-for-on-demand-aws-lambda-event-functions/). So I wanted to build something that actually needs it.

I went with a Monte Carlo sim for the question every United fan is asking: **can Man United still make the top 4?**

Spoiler, they're **19th on 8 points** after 11 games with one league win, a [5–2 against Ipswich in August](https://www.si.com/soccer/man-utd-drop-relegation-zone-man-city-defeat-red-devils-40-year-low). But I wanted a number on it, and one on relegation too.

All the code is on GitHub: [Redm0nd/mufc-montecarlo](https://github.com/Redm0nd/mufc-montecarlo)

## What changed

It's only **Event Functions** that get 30 minutes ([announcement](https://aws.amazon.com/blogs/compute/announcing-30-minute-timeout-for-on-demand-aws-lambda-event-functions/)):

| Lambda type | Sync | Async | Event source mapping |
| --- | --- | --- | --- |
| Event Functions, on demand | 30 min | 30 min | 30 min |
| Event Functions, Managed Instances | 30 min | 90 min | 90 min |
| Web Functions | 15 min | 15 min | 15 min |

Things to be aware of:

- **Amazon MQ, DocumentDB and older Kafka mappings** stay at 14 minutes. Kafka ones created before the 19th won't warn you either.
- **Init is still 10 seconds.**
- **The caller's timeout still wins** on sync invokes, which is why I'm using SQS.

## How it fits together

![Architecture: a message on an SQS queue triggers a Lambda with a 1,800s timeout, which fetches the season CSV from football-data.co.uk and writes results to S3, with a dead-letter queue after 2 failed receives](https://raw.githubusercontent.com/Redm0nd/mufc-montecarlo/main/images/mufc-architecture.png)

A message on the queue says which team and season to run. Lambda pulls the CSV, runs for ~20 minutes and writes JSON to S3. Two failures and it goes to the DLQ.

No one wants to hold an HTTP connection open for 20 minutes, so SQS it is.

## The simulation

I'm not a data scientist, so it's the simple [Maher (1982)](https://en.wikipedia.org/wiki/Poisson_regression) model. Each team gets an attack and defence rating, plus one home advantage number:

```
home goals ~ Poisson(home_adv * attack[home] * defence[away])
away goals ~ Poisson(attack[away] * defence[home])
```

Fit the ratings, play out every remaining fixture, record where United finish. Repeat a lot.

To make it a bit more realistic (and slow):

- **Bootstrapping.** 11 games in nobody knows how good anyone is, so I resample the results and refit 3,000 times.
- **Big games.** For each fixture I track United's odds if they win v lose.

That's 3,000 fits × 10,000 seasons = **30 million seasons**.

2,000 fits would've finished in ~14 minutes, under the old limit, which would've made this a bit pointless. 3,000 took 21.

The core of the handler:

```python
def handler(event, context):
    failures = []
    for record in event["Records"]:
        try:
            job = json.loads(record["body"])
            key = f"results/{job['request_id']}.json"

            # Idempotency: SQS is at-least-once and a 30 minute run is a big
            # window for a duplicate. If the result already exists, skip.
            try:
                s3.head_object(Bucket=RESULTS_BUCKET, Key=key)
                log.info("Result %s already exists, skipping duplicate", key)
                continue
            except ClientError as e:
                if e.response["Error"]["Code"] not in ("404", "NoSuchKey", "NotFound"):
                    raise

            result = run(job, context)
            try:
                # If-None-Match: * means a racing duplicate can't overwrite us
                s3.put_object(Bucket=RESULTS_BUCKET, Key=key, IfNoneMatch="*",
                              Body=json.dumps(result, indent=2),
                              ContentType="application/json")
            except ClientError as e:
                if e.response["Error"]["Code"] != "PreconditionFailed":
                    raise
        except Exception:
            log.exception("Failed processing message %s", record["messageId"])
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}
```

It also stops early if there's less than a minute left, so it never gets killed with nothing saved.

One gotcha: some bootstrap samples give a team zero goals, which numpy happily divides by. A small prior (a couple of pretend games against an average side) sorted it.

## The Terraform

The AWS post only shows CLI and SAM. CloudFormation fans, I'm one of you, but we use Terraform in work.

Full thing is in the repo, here are the interesting bits.

The queue:

```hcl
locals {
  # AWS guidance: SQS visibility timeout >= 6x the function timeout.
  # For a 30 minute function that's 3 hours. Lambda itself only enforces
  # visibility >= 1x the timeout, and only when the event source mapping is
  # created or updated - raising the function timeout later isn't checked.
  visibility_timeout = var.timeout_seconds * 6
}

resource "aws_sqs_queue" "jobs" {
  name                       = "${var.name}-jobs"
  visibility_timeout_seconds = local.visibility_timeout
  message_retention_seconds  = 86400

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 2
  })
}
```

This is the main one to watch out for. AWS recommends 6x, but Lambda only checks visibility ≥ function timeout, and only when the mapping is created or updated.

Bump the function from 900 to 1800 later and nothing complains. Then at minute 15 the message comes back and a second invocation picks it up.

Tying both to one variable stops that.

The function:

```hcl
resource "aws_lambda_function" "sim" {
  function_name    = var.name
  role             = aws_iam_role.lambda.arn
  handler          = "handler.handler"
  runtime          = "python3.14"
  architectures    = ["arm64"]
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256

  # The AWS provider still validates timeout as 1-900, see below
  timeout     = 900
  memory_size = 1769 # one full vCPU - numpy here is single threaded so more won't help

  # Cap how many 30 minute runs can be going at once (and the bill).
  reserved_concurrent_executions = 5

  environment {
    variables = {
      RESULTS_BUCKET   = aws_s3_bucket.results.bucket
      SAFETY_MARGIN_MS = "60000"
    }
  }

  lifecycle {
    ignore_changes = [timeout]
  }
}

resource "aws_lambda_event_source_mapping" "jobs" {
  event_source_arn        = aws_sqs_queue.jobs.arn
  function_name           = aws_lambda_function.sim.arn
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = 5
  }
}
```

### The provider doesn't know about 30 minutes yet

My first `terraform apply` failed straight away on the latest provider (v6.73.0):

```
Error: expected timeout to be in the range (1 - 900), got 1800

  with aws_lambda_function.sim,
  on main.tf line 147, in resource "aws_lambda_function" "sim":
 147:   timeout     = var.timeout_seconds
```

The provider validates it before it ever hits the API. If you read my [CloudFormation vs. Terraform](https://redm0nd.github.io/2024/03/18/CFN-vs-TF.html) post, you'll know this isn't new!

Workaround for now: create it at 900, bump it with the CLI, and `ignore_changes` so Terraform doesn't flip it back:

```hcl
resource "terraform_data" "lambda_timeout" {
  triggers_replace = [var.timeout_seconds, aws_lambda_function.sim.source_code_hash]

  provisioner "local-exec" {
    command = <<-EOT
      aws lambda wait function-updated-v2 --region ${var.region} --function-name ${aws_lambda_function.sim.function_name}
      aws lambda update-function-configuration --region ${var.region} --function-name ${aws_lambda_function.sim.function_name} --timeout ${var.timeout_seconds} --query Timeout
      aws lambda wait function-updated-v2 --region ${var.region} --function-name ${aws_lambda_function.sim.function_name}
    EOT
  }
}
```

The mapping gets a `depends_on` on that so SQS doesn't start invoking at 15 minutes.

It's a bit of a hack. There's already an open PR, [hashicorp/terraform-provider-aws#51180](https://github.com/hashicorp/terraform-provider-aws/pull/51180), so give it a 👍.

Other settings:

- **1769 MB** = one full vCPU. It's single threaded so more is just more cost.
- **batch_size = 1.** 10 jobs × 20 minutes won't fit.
- **Reserved concurrency of 5.** More on that below.
- **arm64.** Cheaper, and numpy has aarch64 wheels (`build.sh` handles the packaging).

## Deploy and run it

```bash
git clone https://github.com/Redm0nd/mufc-montecarlo.git && cd mufc-montecarlo
bash build.sh
cd terraform
terraform init
terraform apply -var region=eu-west-1
```

Small CloudShell gotcha: the home dir is only 1GB and the AWS provider is several hundred MB, so `terraform init` fails. Point it at `/tmp`:

```bash
export TF_DATA_DIR=/tmp/tfdata
```

![Lambda console showing the mufc-montecarlo function with an SQS trigger, 1769 MB memory and a 30 min timeout](https://raw.githubusercontent.com/Redm0nd/mufc-montecarlo/main/images/lambda-config-30min.png)

Drop a job on the queue (`2627` is football-data's code for 2026/27):

```bash
aws sqs send-message \
  --queue-url "$(terraform output -raw queue_url)" \
  --message-body '{"request_id":"mufc-2026-11-23","season":"2627","team":"Man United","bootstrap_fits":3000,"sims_per_fit":10000,"seed":2026}'
```

![CloudWatch log lines showing fit 3000/3000 done and a REPORT line with Duration 1278417.90 ms](https://raw.githubusercontent.com/Redm0nd/mufc-montecarlo/main/images/lambda-report-21min.png)

**1,278,417 ms**, just over 21 minutes in one invocation. Before the 19th that would've died at 900,000.

Max memory used was 197 MB, so the 1769 is only there for the CPU.

## So, can United make the top 4?

No. But now there's a number on it:

| Outcome | Probability | Roughly |
| --- | --- | --- |
| Win the league | 0.00007% | 20 times in 30 million seasons |
| Top 4 | 0.04% | 1 in 2,600 |
| Top 6 | 0.31% | 1 in 330 |
| Stay up (17th or better) | 56.1% | |
| Relegated | 43.9% | |
| Finish bottom | 15.0% | 1 in 7 |

![Bar chart of Man United's finishing position across 30 million simulated seasons, peaking at 19th, with 43.9% in the relegation places](https://raw.githubusercontent.com/Redm0nd/mufc-montecarlo/main/images/mufc-finishing-position.png)

**1 in 2,600** for the top 4. The scarier one is **44% for relegation**.

To be fair, the [Opta supercomputer](https://theanalyst.com/?p=268045) only has them going down about 21% of the time, so mine is probably on the high side. It only looks at this season's results, so take it with a pinch of salt.

The six-pointers:

| Fixture | Relegated if win | if draw | if loss | Swing (win v loss) |
| --- | --- | --- | --- | --- |
| Man United v Crystal Palace | 33% | 53% | 63% | 30% |
| Man United v Coventry | 31% | 50% | 61% | 30% |
| Coventry v Man United | 27% | 44% | 56% | 29% |
| Ipswich v Man United | 26% | 43% | 55% | 29% |
| Crystal Palace v Man United | 29% | 47% | 57% | 28% |

![Chart of United's relegation odds if they win, draw or lose each of their six biggest remaining games](https://raw.githubusercontent.com/Redm0nd/mufc-montecarlo/main/images/mufc-six-pointers.png)

Beat Palace at home and it's about a third. Lose and it's nearly two in three.

### Could City save United?

City were [found guilty on 114 of the 115 charges](https://www.aljazeera.com/sports/2026/9/25/man-city-found-guilty-on-almost-all-115-premier-league-charges-report) in September, with the [appeal due by January](https://www.aljazeera.com/sports/2026/10/14/manchester-city-appeal-over-charges-to-be-heard-by-january-says-regulator). [One report](https://www.football365.com/news/man-city-ffp-likely-point-deduction-three-pronged-punishment) reckons -50 points.

So I ran that too:

| Scenario | Relegated | Finish bottom | Expected position |
| --- | --- | --- | --- |
| As things stand | 43.9% | 15.0% | 16.4 |
| City docked 50 points | 30.7% | 2.4% | 15.4 |

Still nearly one in three. Imagine both Manchester clubs in the Championship next season...

## Gotchas to watch out for

- **Visibility timeout.** Raise the function timeout later and nothing re-checks it.
- **Concurrency.** 1 request a second at 30 minutes = 1,800 concurrent. That's over the usual 1,000 regional limit, so cap it.
- **Retries.** A failure at minute 28 runs again before the DLQ. That's an hour for one bad message.
- **Idle connections.** Behind a NAT gateway they drop after 350 seconds.
- **Tokens.** If you grab one at the start, make sure it lasts 30 minutes.
- **Duplicates.** Longer runs, bigger window. I check S3 first and write with `IfNoneMatch="*"`, no DynamoDB needed.

## Cost

**checks AWS bill** About 2,200 GB-seconds a run, so under **4 cents**. The free tier covers ~180 a month.

## Clean up

```bash
cd terraform
terraform destroy
```

## Conclusion

Big fan of this one. Loads of jobs I'd have put on Fargate or Batch can just be a Lambda now.

Just watch the visibility timeout, concurrency and retries, as AWS won't warn you about most of them.

Next I want to try it as a durable function and push past 30 minutes. I'll look at that in a future post...
