---
layout: post
title:  "Automating AWS Instances with Ansible"
date:   2020-02-09 23:12:30 +0100
categories: jekyll update
---
This post describes the deployment of an aws ami rstudio and it's management with cron jobs

WIP: Will be updating partially over the next few weeks

aws ec2 describe-instances
---
- name: Get EC2 RStudio Instance Info
  connection: localhost
  command: aws ec2 describe-instances
  register: my_instance_facts
aws ec2 describe-instances | grep PublicDnsName
---

- name: return rstudio public dns
  gather_facts: false
  hosts: localhost
  tasks:
    - command: aws ec2 describe-instances
      register: instance_facts
aws ec2 start-instances --instance-ids i-0c46a927f7a75XXXX
---

- name: Start rstudio instance
  gather_facts: false
  hosts: localhost
  tasks:
    - command: aws ec2 start-instances --instance-ids i-0c46a927f7a75XXXX
aws ec2 stop-instances --instance-ids i-0c46a927f7a75XXXX
---

- name: Stop rstudio instance
  gather_facts: false
  hosts: localhost
  tasks:
    - command: aws ec2 stop-instances --instance-ids i-0c46a927f7a75XXXX
