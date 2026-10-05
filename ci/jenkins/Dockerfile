# Jenkins LTS controller with the CI toolchain used by ci/Jenkinsfile:
# docker CLI (+buildx), AWS CLI v2, Trivy, cosign, Syft, yq, Node.js 22, sonar-scanner, jq, git.
FROM jenkins/jenkins:lts-jdk21

ARG TRIVY_VERSION=0.67.2
ARG COSIGN_VERSION=2.6.1
ARG SYFT_VERSION=1.33.0
ARG YQ_VERSION=4.47.2
ARG SONAR_SCANNER_VERSION=7.2.0.5079
ARG NODE_MAJOR=22

USER root
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg unzip jq git make; \
    install -m 0755 -d /etc/apt/keyrings; \
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc; \
    echo "deb [signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list; \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg; \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends docker-ce-cli docker-buildx-plugin nodejs; \
    rm -rf /var/lib/apt/lists/*

# AWS CLI v2
RUN set -eux; arch="$(uname -m)"; \
    curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${arch}.zip" -o /tmp/awscli.zip; \
    unzip -q /tmp/awscli.zip -d /tmp; /tmp/aws/install; rm -rf /tmp/aws /tmp/awscli.zip; aws --version

# Trivy (+ report templates), cosign, syft, yq, sonar-scanner
RUN set -eux; \
    dpkgArch="$(dpkg --print-architecture)"; \
    case "$dpkgArch" in amd64) tArch=64bit ;; arm64) tArch=ARM64 ;; *) echo "unsupported $dpkgArch"; exit 1 ;; esac; \
    curl -fsSL "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-${tArch}.tar.gz" | tar -xz -C /usr/local/bin trivy; \
    mkdir -p /usr/local/share/trivy/templates; \
    for t in junit.tpl html.tpl; do curl -fsSL "https://raw.githubusercontent.com/aquasecurity/trivy/v${TRIVY_VERSION}/contrib/${t}" -o /usr/local/share/trivy/templates/${t}; done; \
    curl -fsSL "https://github.com/sigstore/cosign/releases/download/v${COSIGN_VERSION}/cosign-linux-${dpkgArch}" -o /usr/local/bin/cosign; \
    curl -fsSL "https://github.com/anchore/syft/releases/download/v${SYFT_VERSION}/syft_${SYFT_VERSION}_linux_${dpkgArch}.tar.gz" | tar -xz -C /usr/local/bin syft; \
    curl -fsSL "https://github.com/mikefarah/yq/releases/download/v${YQ_VERSION}/yq_linux_${dpkgArch}" -o /usr/local/bin/yq; \
    chmod +x /usr/local/bin/cosign /usr/local/bin/yq; \
    curl -fsSL "https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/sonar-scanner-cli-${SONAR_SCANNER_VERSION}-linux-x64.zip" -o /tmp/ss.zip \
      || curl -fsSL "https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/sonar-scanner-cli-${SONAR_SCANNER_VERSION}.zip" -o /tmp/ss.zip; \
    unzip -q /tmp/ss.zip -d /opt; mv /opt/sonar-scanner-* /opt/sonar-scanner; ln -s /opt/sonar-scanner/bin/sonar-scanner /usr/local/bin/sonar-scanner; rm /tmp/ss.zip; \
    trivy --version; cosign version; syft version; yq --version; node --version

# The docker socket is bind-mounted; the compose file adds the host's docker GID via group_add.
USER jenkins

COPY --chown=jenkins:jenkins plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt --verbose

COPY --chown=jenkins:jenkins casc.yaml /var/jenkins_home/casc_configs/casc.yaml
ENV CASC_JENKINS_CONFIG=/var/jenkins_home/casc_configs/casc.yaml \
    JAVA_OPTS="-Djenkins.install.runSetupWizard=false -Xmx2g"
